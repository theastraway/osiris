/**
 * POST /api/ozzie/cron/analyst  (header X-Cron-Secret)
 * The autonomous analyst cycle — runs perpetually, free (owl + Postgres):
 *   1. pick the most-mentioned entities in the graph
 *   2. gather everything known about each (full-text)
 *   3. owl writes/refreshes a LIVING DOSSIER (identity · cross-source links · risk · confidence)
 *   4. score cross-domain presence → high-signal entities become SIGNALS
 *   5. email the verified signal digest
 * Self-improving: dossiers get richer every cycle as more data lands.
 */
import { NextRequest, NextResponse } from 'next/server';
import { topEntities, searchItems, upsertDossier, stats } from '@/lib/db';
import { sendEmail, alertDestination } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const CYCLE = Number(process.env.ANALYST_CYCLE || 6);  // entities per cycle (owl free → scale freely)

async function owl(prompt: string, max = 900): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.25, max_tokens: max }),
    signal: AbortSignal.timeout(45000),
  });
  return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'no owl' }, { status: 503 });

  const ents = await topEntities(CYCLE * 3);
  const signals: Array<{ entity: string; type: string; crossDomain: number; summary: string }> = [];
  let dossiers = 0;

  for (const e of ents.slice(0, CYCLE)) {
    const items = await searchItems(e.name, 14);
    if (!items.length) continue;
    const sources = [...new Set(items.map((i) => i.source))];
    const crossDomain = sources.length;
    const ctx = items.map((i, n) => `[${n + 1}] (${i.source}) ${i.title}\n${i.content.slice(0, 500)}`).join('\n\n');
    const dossier = await owl(
      `You are Ozzie, a senior OSINT analyst. Write/refresh a LIVING DOSSIER (markdown) for the entity "${e.name}" (${e.type}) from the intelligence below. Sections: ## Identity, ## What's Known, ## Cross-Source Connections (which domains/sources link to it — this is the value), ## Risk Assessment, ## Confidence (0-1, and why). Be specific, cite [n]. If thin, say so.\n\nINTELLIGENCE (${sources.length} source domains: ${sources.join(', ')}):\n${ctx.slice(0, 8000)}`,
      1100,
    );
    const conf = Number((dossier.match(/confidence[^\d]*([01](?:\.\d+)?)/i) || [])[1] || 0.5);
    await upsertDossier(e.name, e.type, dossier, conf, crossDomain);
    dossiers++;
    if (crossDomain >= 2) {
      const oneLine = (dossier.match(/##\s*Risk Assessment\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || dossier).trim().replace(/\s+/g, ' ').slice(0, 220);
      signals.push({ entity: e.name, type: e.type, crossDomain, summary: oneLine });
    }
  }

  // Email the verified signal digest (cross-domain = the high-value leads)
  let emailed = false;
  const to = await alertDestination();
  if (to && signals.length) {
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const rows = signals.sort((a, b) => b.crossDomain - a.crossDomain).map((s) => `<li><b>${s.entity}</b> <span style="color:#888">(${s.type} · ${s.crossDomain} domains)</span><br/>${s.summary}</li>`).join('');
    const html = `<div style="font-family:system-ui,sans-serif;max-width:680px"><h2>🛰️ Ozzie Signal Digest — ${date}</h2><p>${signals.length} cross-domain entities surfaced this cycle:</p><ul style="line-height:1.6">${rows}</ul><hr/><small>Osiris · osiris.theastraway.com</small></div>`;
    const text = signals.map((s) => `${s.entity} (${s.type}, ${s.crossDomain} domains): ${s.summary}`).join('\n\n');
    emailed = await sendEmail(to, `🛰️ Ozzie Signal Digest — ${signals.length} cross-domain leads`, html, text);
  }

  return NextResponse.json({ ok: true, dossiers, signals: signals.length, emailed, graph: await stats() });
}
