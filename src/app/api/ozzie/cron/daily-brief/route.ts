/**
 * POST /api/ozzie/cron/daily-brief  (header X-Cron-Secret)
 * Ozzie's morning intelligence brief: pull recent KG activity → owl synthesises
 * → email the brief (Resend) → persist to the @ozzie MIND graph.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { sendEmail } from '@/lib/notify';
import { logRun } from '@/lib/runlog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const BRIEF_EMAIL = process.env.OZZIE_BRIEF_EMAIL || 'anthony@theastraway.com';

async function mindQuery(q: string): Promise<string> {
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(30000),
    });
    return ((await r.json()) as { response?: string }).response || '';
  } catch { return ''; }
}

async function owl(prompt: string): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 900 }),
    signal: AbortSignal.timeout(45000),
  });
  return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const recent = await mindQuery('Summarize the most recent Ozzie OSINT investigations, dossiers, and intelligence findings. List targets and key facts.');
  const brief = await owl(`You are Ozzie, an OSINT analyst. Write a concise morning intelligence brief (markdown) from the recent activity below. Sections: ## Overnight Summary, ## Key Findings, ## Recommended Follow-ups. If there is little activity, say so briefly.\n\nRECENT ACTIVITY:\n${recent || '(no recent activity recorded)'}`);

  const date = new Date().toISOString().slice(0, 10);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px"><h2>🛰️ Ozzie Daily Intelligence Brief — ${date}</h2><pre style="white-space:pre-wrap;font-family:inherit;line-height:1.6">${brief.replace(/</g, '&lt;')}</pre><hr/><small>Osiris · osiris.theastraway.com</small></div>`;
  const sent = await sendEmail(BRIEF_EMAIL, `🛰️ Ozzie Daily Brief — ${date}`, html, brief);

  after(async () => {
    try {
      await fetch(`${MIND_BASE}/developer/v1/documents`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
        body: JSON.stringify({ title: `Ozzie Daily Brief - ${date}`, content: brief, source: 'Ozzie daily brief', tags: ['ozzie', 'brief', 'daily'] }),
        signal: AbortSignal.timeout(60000),
      });
    } catch { /* best effort */ }
  });

  await logRun('daily-brief', true, `brief ${brief.length} chars · emailed ${sent}`);
  return NextResponse.json({ ok: true, emailed: sent, date, brief_chars: brief.length });
}
