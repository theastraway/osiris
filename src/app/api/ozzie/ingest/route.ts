/**
 * POST /api/ozzie/ingest?source=<name>  (header X-Cron-Secret)
 * Fetch new items → SENSE (owl: normalize/score/structure, drop noise) → write the
 * structured, entity-rich document to the @ozzie MIND knowledge graph. owl (free)
 * does the reasoning; MIND builds the real graph + semantic index. This is a MIND
 * project — the KG is the product. Volume is capped to keep credit burn sane.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getState, setCursor, postDoc } from '@/lib/ingest';
import { SOURCES } from '@/lib/ingest-sources';
import { sense } from '@/lib/preprocess';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const CAP = Number(process.env.INGEST_CAP || 4);        // docs written to MIND/run
const PRE_CAP = Number(process.env.INGEST_PRE_CAP || 8); // raw items run through Sense/run

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const source = req.nextUrl.searchParams.get('source') || '';
  const fetcher = SOURCES[source];
  if (!fetcher) return NextResponse.json({ error: 'unknown source', available: Object.keys(SOURCES) }, { status: 400 });

  try {
    const prev = (await getState())[source] || '';
    const { items, cursor } = await fetcher(prev);

    let dropped = 0, written = 0;
    for (const raw of items.slice(0, PRE_CAP)) {
      const s = await sense({ title: raw.title, content: raw.content, baseTags: raw.tags });
      if (!s) { dropped++; continue; }                  // below significance → noise, not ingested
      if (await postDoc(s.title, s.content, s.tags)) written++;   // structured, entity-rich → MIND KG
      if (written >= CAP) break;
    }
    if (cursor && cursor !== prev) await setCursor(source, cursor);
    return NextResponse.json({ ok: true, source, found: items.length, written, dropped_as_noise: dropped });
  } catch (e) {
    return NextResponse.json({ ok: false, source, error: (e as Error).message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ sources: Object.keys(SOURCES) });
}
