/**
 * POST /api/ozzie/cron/analyst  (header X-Cron-Secret)
 * Autonomous analyst cycle, MIND-native + owl-powered (owl free, MIND is the KG):
 *   1. ask MIND for the most significant recent entities worth a dossier
 *   2. for each, pull everything MIND knows (graph + semantic RAG)
 *   3. owl writes/refreshes a LIVING DOSSIER → back into the @ozzie graph
 *   4. cross-domain entities become verified SIGNALS → emailed
 * Self-improving: every cycle the graph gets richer and the dossiers sharper.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { postDoc } from '@/lib/ingest';
import { sendEmail, alertDestination } from '@/lib/notify';
import { logRun } from '@/lib/runlog';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const CYCLE = Number(process.env.ANALYST_CYCLE || 2);  // entities/cycle — keep run < maxDuration (MIND queries are slow)

async function mindQuery(query: string): Promise<string> {
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query, mode: 'hybrid' }), signal: AbortSignal.timeout(45000),
    });
    return ((await r.json()) as { response?: string }).response || '';
  } catch { return ''; }
}
async function owl(prompt: string, max = 1000): Promise<string> {
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
  if (!MIND_KEY || !OPENROUTER_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // 1. ask the graph which entities deserve a dossier this cycle
  const recent = await mindQuery('List the most significant organizations, products, people, vendors, or entities recently added to the intelligence graph (vulnerabilities, sanctions, filings, contracts, events). Return just a comma-separated list of the entity names, most important first.');
  const names = [...new Set(recent.replace(/\n/g, ',').split(/,|;/).map((s) => s.replace(/^[\s\d.\-*•]+/, '').trim()).filter((s) => s.length > 2 && s.length < 80))].slice(0, CYCLE);

  const signals: Array<{ entity: string; line: string }> = [];
  let dossiers = 0;
  for (const entity of names) {
    const known = await mindQuery(`Everything known about "${entity}": identity, which intelligence domains/sources mention it (vulnerabilities, sanctions, filings, contracts, events), cross-source connections, and risk.`);
    if (!known || known.length < 60) continue;
    const dossier = await owl(`You are Ozzie, a senior OSINT analyst. Write/refresh a LIVING DOSSIER (markdown) for "${entity}" from the graph intelligence below. Sections: ## Identity, ## What's Known, ## Cross-Source Connections (which domains link to it — the value), ## Risk Assessment, ## Confidence (0-1). Be specific. If thin, say so.\n\nGRAPH INTELLIGENCE:\n${known.slice(0, 6000)}`, 1100);
    after(async () => { await postDoc(`Dossier: ${entity}`, dossier, ['ozzie', 'dossier', 'entity']); });
    dossiers++;
    if (/cross-source|multiple (domains|sources)|appears in both|linked to/i.test(known + dossier)) {
      const line = (dossier.match(/##\s*Risk Assessment\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || dossier).trim().replace(/\s+/g, ' ').slice(0, 220);
      signals.push({ entity, line });
    }
  }

  let emailed = false;
  const to = await alertDestination();
  if (to && signals.length) {
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const rows = signals.map((s) => `<li><b>${s.entity}</b><br/>${s.line}</li>`).join('');
    const html = `<div style="font-family:system-ui,sans-serif;max-width:680px"><h2>🛰️ Ozzie Signal Digest — ${date}</h2><p>${signals.length} cross-domain entities surfaced:</p><ul style="line-height:1.6">${rows}</ul><hr/><small>Osiris</small></div>`;
    emailed = await sendEmail(to, `🛰️ Ozzie Signal Digest — ${signals.length} cross-domain leads`, html, signals.map((s) => `${s.entity}: ${s.line}`).join('\n\n'));
  }

  await logRun('analyst', true, `dossiers ${dossiers} · signals ${signals.length}${signals.length ? ' (' + signals.map((s) => s.entity).join(', ') + ')' : ''}`);
  return NextResponse.json({ ok: true, evaluated: names.length, dossiers, signals: signals.length, emailed });
}
