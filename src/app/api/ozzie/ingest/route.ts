/**
 * POST /api/ozzie/ingest?source=<name>  (header X-Cron-Secret)
 * One ingestion source → fetch new items → run each through the SENSE layer
 * (owl normalises + scores + structures, drops noise) → post the high-signal,
 * entity-rich docs to the @ozzie knowledge graph → advance cursor.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getState, setCursor, postDoc } from '@/lib/ingest';
import { SOURCES } from '@/lib/ingest-sources';
import { sense } from '@/lib/preprocess';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const CAP = Number(process.env.INGEST_CAP || 3);        // max docs written/run
const PRE_CAP = Number(process.env.INGEST_PRE_CAP || 6); // max raw items run through Sense/run

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

    let dropped = 0, ingested = 0;
    for (const raw of items.slice(0, PRE_CAP)) {
      const s = await sense({ title: raw.title, content: raw.content, baseTags: raw.tags });
      if (!s) { dropped++; continue; }                 // below significance threshold = noise
      if (await postDoc(s.title, s.content, s.tags)) ingested++;
      if (ingested >= CAP) break;
    }
    if (cursor && cursor !== prev) await setCursor(source, cursor);
    return NextResponse.json({ ok: true, source, found: items.length, ingested, dropped_as_noise: dropped });
  } catch (e) {
    return NextResponse.json({ ok: false, source, error: (e as Error).message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ sources: Object.keys(SOURCES) });
}
