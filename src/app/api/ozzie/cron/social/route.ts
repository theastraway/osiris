/**
 * POST /api/ozzie/cron/social  (header X-Cron-Secret)
 * Auto-post workflow: if enabled, owl drafts a post from the day's intelligence and
 * publishes it to each configured channel via Blotato. Ozzie posts itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { channels, publish, getSocialConfig } from '@/lib/blotato';
import { logRun } from '@/lib/runlog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/free';

async function mindQuery(q: string): Promise<string> {
  try { const r = await fetch(`${MIND_BASE}/developer/v1/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY }, body: JSON.stringify({ query: q, mode: 'hybrid' }), signal: AbortSignal.timeout(60000) }); return ((await r.json()) as { response?: string }).response || ''; } catch { return ''; }
}
async function owl(prompt: string): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: 500 }), signal: AbortSignal.timeout(45000) });
  return (r.ok ? (await r.json()).choices?.[0]?.message?.content?.trim() : '') || '';
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cfg = await getSocialConfig();
  if (!cfg.enabled || !cfg.autoChannels.length) return NextResponse.json({ ok: true, skipped: 'auto-post disabled' });

  const intel = await mindQuery('What is the single most significant, postable intelligence finding in the graph right now — an actively-exploited vulnerability, a notable cross-source connection, or a key development? Be specific with names.');
  const results: Array<{ channel: string; ok: boolean }> = [];
  for (const id of cfg.autoChannels) {
    const ch = channels().find((c) => c.id === id); if (!ch) continue;
    const limit = ch.platform === 'twitter' ? '280 characters, punchy, 1-2 hashtags' : 'up to 1000 characters, analytical and credible';
    const post = await owl(`You are Ozzie, an OSINT analyst with a sharp public voice. Write ONE ${ch.platform} post (${limit}) from this finding. Specific and credible, not vague. Subtle nod to Osiris. ONLY the post text.\n\nFINDING:\n${intel.slice(0, 3000)}`);
    if (!post) continue;
    const r = await publish(ch, post);
    results.push({ channel: ch.label, ok: r.ok });
  }
  await logRun('social', true, `posted ${results.filter((r) => r.ok).length}/${results.length}`);
  return NextResponse.json({ ok: true, posted: results });
}
