/**
 * POST /api/ozzie/cron/intel-report  (header X-Cron-Secret)
 * The ANALYSIS layer. Mines the @ozzie knowledge graph (RAG over everything
 * ingested) across several analytical lenses, has owl synthesise an analyst-grade
 * intelligence report, saves it to the graph (tag ozzie/report), and emails it.
 * This is what turns the raw 24/7 ingestion into a sellable intelligence product.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { sendEmail, alertDestination } from '@/lib/notify';
import { logRun } from '@/lib/runlog';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';

async function mindQuery(query: string): Promise<string> {
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query, mode: 'hybrid' }), signal: AbortSignal.timeout(45000),
    });
    return ((await r.json()) as { response?: string }).response || '';
  } catch { return ''; }
}
async function owl(prompt: string, maxTokens = 1500): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60000),
  });
  return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
}

// The analytical lenses run against the accumulated graph.
const LENSES: Array<{ key: string; q: string }> = [
  { key: 'developments', q: 'Summarize the most significant intelligence from the last 24-48 hours across cyber vulnerabilities (CVE/CISA KEV), sanctions, SEC corporate filings, US federal contracts, and global events. What are the top developments an analyst must know?' },
  { key: 'connections', q: 'Identify organizations, people, products, or entities that appear across MORE THAN ONE intelligence domain — e.g. a company with both a newly exploited vulnerability and a federal contract, or an entity appearing in both a sanctions context and a news event. List these cross-source connections; they are the highest-value leads.' },
  { key: 'risks', q: 'Based on recent intelligence in the graph, what emerging risks, threat patterns, sectors under pressure, or notable trends are forming? What entities should be put on a watchlist and why?' },
];

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!MIND_KEY || !OPENROUTER_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // 1. Pull each analytical lens from the graph (RAG).
  const findings: Record<string, string> = {};
  for (const l of LENSES) findings[l.key] = await mindQuery(l.q);

  // 2. owl synthesises an analyst-grade report.
  const date = new Date().toISOString().slice(0, 10);
  const report = await owl(
    `You are Ozzie, a senior OSINT analyst. Write a concise, analyst-grade INTELLIGENCE REPORT (markdown) for ${date} from the graph findings below. Sections:\n## Executive Summary\n## Top Developments\n## Cross-Source Connections (the highest-value leads — be specific about which entities link which domains)\n## Emerging Risks\n## Recommended Watch Items\nBase everything strictly on the findings; if a lens is thin, say so briefly. No preamble.\n\n[DEVELOPMENTS]\n${findings.developments || '(none)'}\n\n[CROSS-SOURCE CONNECTIONS]\n${findings.connections || '(none)'}\n\n[EMERGING RISKS]\n${findings.risks || '(none)'}`,
  );

  // 3. Persist the report to the graph + email it.
  const title = `Ozzie Intelligence Report — ${date}`;
  after(async () => {
    try {
      await fetch(`${MIND_BASE}/developer/v1/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
        body: JSON.stringify({ title, content: report, source: 'Ozzie report', tags: ['ozzie', 'report', 'intelligence'] }),
        signal: AbortSignal.timeout(90000),
      });
    } catch { /* best effort */ }
  });

  const to = await alertDestination();
  let emailed = false;
  if (to) {
    const html = `<div style="font-family:system-ui,sans-serif;max-width:680px"><h2>🛰️ ${title}</h2><pre style="white-space:pre-wrap;font-family:inherit;line-height:1.65">${report.replace(/</g, '&lt;')}</pre><hr/><small>Osiris · osiris.theastraway.com/ozzie</small></div>`;
    emailed = await sendEmail(to, `🛰️ ${title}`, html, report);
  }

  await logRun('intel-report', true, `report ${report.length} chars · emailed ${emailed}`);
  return NextResponse.json({ ok: true, date, emailed, report_chars: report.length, lenses: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length])) });
}
