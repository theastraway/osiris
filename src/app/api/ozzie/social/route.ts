/**
 * POST /api/ozzie/social  (admin-gated)  { action, ... }
 *  - channels            → connected Blotato channels + availability
 *  - generate {source,topic,channel} → owl drafts a platform-tailored post from Ozzie's intel
 *  - post {channelId,text} → publish via Blotato + log
 *  - log                 → recent posts
 * Ozzie's social arm: turn the intelligence graph into posts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, ADMIN_COOKIE } from '@/lib/billing';
import { channels, blotatoAvailable, publish, getSocialConfig, setSocialConfig } from '@/lib/blotato';
import fs from 'fs/promises';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const LOG = `${process.env.OSIRIS_DATA_DIR || '/data'}/social_log.json`;

async function mindQuery(q: string): Promise<string> {
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY }, body: JSON.stringify({ query: q, mode: 'hybrid' }), signal: AbortSignal.timeout(60000) });
    return ((await r.json()) as { response?: string }).response || '';
  } catch { return ''; }
}
async function owl(prompt: string): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' }, body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.6, max_tokens: 500 }), signal: AbortSignal.timeout(45000) });
  return (r.ok ? (await r.json()).choices?.[0]?.message?.content?.trim() : '') || '';
}
async function readLog(): Promise<unknown[]> { try { return JSON.parse(await fs.readFile(LOG, 'utf8')); } catch { return []; } }
async function appendLog(e: unknown): Promise<void> { const l = await readLog(); l.unshift(e); try { await fs.mkdir(LOG.replace(/\/[^/]+$/, ''), { recursive: true }); } catch {} await fs.writeFile(LOG, JSON.stringify(l.slice(0, 100))); }

export async function POST(req: NextRequest) {
  if (!isAdmin(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: 'admin required' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === 'channels') return NextResponse.json({ available: blotatoAvailable(), channels: channels() });
  if (action === 'log') return NextResponse.json({ log: await readLog() });
  if (action === 'get_config') return NextResponse.json(await getSocialConfig());
  if (action === 'set_config') return NextResponse.json(await setSocialConfig({ enabled: Boolean(body.enabled), autoChannels: Array.isArray(body.autoChannels) ? body.autoChannels : [] }));

  if (action === 'generate') {
    const ch = channels().find((c) => c.id === body.channel) || channels()[0];
    const platform = ch?.platform || 'twitter';
    const limit = platform === 'twitter' ? '280 characters, punchy, 1-2 hashtags' : 'up to 1100 characters, analytical and credible, a few line breaks';
    let intel = '';
    if (body.source === 'custom' && body.topic) intel = `Topic: ${body.topic}`;
    else intel = await mindQuery(body.source === 'dossier' ? 'Summarize the most significant entity dossier and its risk in the graph.' : 'What are the top intelligence developments, actively-exploited vulnerabilities, and cross-source connections in the graph right now? Be specific with names.');
    const post = await owl(`You are Ozzie, an OSINT intelligence analyst with a sharp public voice (think a respected threat-intel account). Write ONE ${platform} post (${limit}) from the intelligence below. Make it specific, credible, and intriguing — a real finding, not vague hype. No emojis overload. End with a subtle nod to Osiris/Ozzie. Output ONLY the post text.\n\nINTELLIGENCE:\n${(intel || 'general OSINT capabilities').slice(0, 4000)}`);
    return NextResponse.json({ draft: post, channel: ch });
  }

  if (action === 'post') {
    const ch = channels().find((c) => c.id === body.channelId);
    if (!ch) return NextResponse.json({ error: 'unknown channel' }, { status: 400 });
    if (!body.text) return NextResponse.json({ error: 'text required' }, { status: 400 });
    const res = await publish(ch, String(body.text), Array.isArray(body.mediaUrls) ? body.mediaUrls : []);
    await appendLog({ at: new Date().toISOString(), channel: ch.label, platform: ch.platform, ok: res.ok, text: String(body.text).slice(0, 280), status: res.status });
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
