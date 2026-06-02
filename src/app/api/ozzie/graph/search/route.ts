/**
 * GET/POST /api/ozzie/graph/search?q=...
 * Public retrieval over Ozzie's own graph: Postgres full-text search → owl
 * synthesises a cited intelligence answer. Free (owl + Postgres), no MIND credits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchItems, getDossier } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';

async function owl(prompt: string): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 900 }),
    signal: AbortSignal.timeout(45000),
  });
  return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
}

async function answer(q: string) {
  const dossier = await getDossier(q);
  const items = await searchItems(q, 12);
  if (!items.length && !dossier) return { query: q, answer: 'No intelligence found in the graph yet for that query.', sources: 0 };
  const ctx = [
    dossier ? `LIVING DOSSIER (updated ${dossier.updated}):\n${dossier.content}` : '',
    ...items.map((i, n) => `[${n + 1}] (${i.source}) ${i.title}\n${i.content.slice(0, 600)}`),
  ].filter(Boolean).join('\n\n');
  const synth = OPENROUTER_KEY
    ? await owl(`You are Ozzie, an OSINT analyst. Answer the question using ONLY the intelligence below. Cite sources by their [n] or dossier. Be specific and analytical; if thin, say so.\n\nQUESTION: ${q}\n\nINTELLIGENCE:\n${ctx.slice(0, 9000)}`)
    : ctx.slice(0, 2000);
  return { query: q, answer: synth, sources: items.length, has_dossier: Boolean(dossier) };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
  return NextResponse.json(await answer(q));
}
export async function POST(req: NextRequest) {
  const { q } = await req.json().catch(() => ({ q: '' }));
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
  return NextResponse.json(await answer(q));
}
