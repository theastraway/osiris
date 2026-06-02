/**
 * POST /api/ozzie/ingest?source=<name>  (header X-Cron-Secret)
 * Runs one ingestion source: fetch new items since cursor → cap → post to the
 * @ozzie knowledge graph → advance cursor. Drives the 24/7 OSINT database.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getState, setCursor, ingestBatch } from '@/lib/ingest';
import { SOURCES } from '@/lib/ingest-sources';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const CAP = Number(process.env.INGEST_CAP || 8);   // max docs/source/run — protects MIND ingestion + credits

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
    const ingested = await ingestBatch(items, CAP);
    if (cursor && cursor !== prev) await setCursor(source, cursor);
    return NextResponse.json({ ok: true, source, found: items.length, ingested, capped: items.length > CAP });
  } catch (e) {
    return NextResponse.json({ ok: false, source, error: (e as Error).message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ sources: Object.keys(SOURCES) });
}
