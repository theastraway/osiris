/**
 * GET/POST /api/ozzie/graph/search?q=...
 * Public retrieval over Ozzie's MIND knowledge graph — MIND's graph + semantic RAG
 * does the heavy retrieval, owl sharpens the answer. The KG is the product.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';

async function answer(q: string) {
  if (!MIND_KEY) return { query: q, answer: 'Graph not configured.', sources: 0 };
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query: q, mode: 'hybrid' }), signal: AbortSignal.timeout(95000),
    });
    const j = (await r.json()) as { response?: string; sources?: unknown[] };
    return { query: q, answer: j.response || 'No intelligence found in the graph yet for that query.', sources: (j.sources || []).length };
  } catch (e) {
    return { query: q, answer: `Retrieval error: ${(e as Error).message}`, sources: 0 };
  }
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
