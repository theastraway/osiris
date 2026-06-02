/**
 * POST /api/ozzie/ingest?source=<name>  (header X-Cron-Secret)
 * Fetch new items → SENSE (owl: normalize/score/structure, drop noise) → write the
 * resolved graph (items + entities + edges) to OUR Postgres. Free owl + free store,
 * ~zero MIND credits, unbounded scale.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getState, setCursor } from '@/lib/ingest';
import { SOURCES } from '@/lib/ingest-sources';
import { sense } from '@/lib/preprocess';
import { insertItem, upsertEntity, insertEdge, stats } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const PRE_CAP = Number(process.env.INGEST_PRE_CAP || 12); // raw items run through Sense/run (owl is free → can be generous)
const idFor = (source: string, title: string) => `${source}:${crypto.createHash('sha1').update(title).digest('hex').slice(0, 16)}`;

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

    let dropped = 0, written = 0, ents = 0, rels = 0;
    for (const raw of items.slice(0, PRE_CAP)) {
      const s = await sense({ title: raw.title, content: raw.content, baseTags: raw.tags });
      if (!s) { dropped++; continue; }
      const id = idFor(source, raw.title);
      const isNew = await insertItem({ id, source, title: s.title, content: s.content, significance: s.significance });
      if (!isNew) continue;
      written++;
      for (const e of s.entities.slice(0, 12)) { await upsertEntity(e.name, e.type || 'entity'); ents++; }
      for (const r of s.relationships.slice(0, 12)) {
        const m = r.split(/—|--|->|→/).map((x) => x.trim());
        if (m.length >= 2) { await insertEdge(m[0], m.length >= 3 ? m[1] : 'related', m[m.length - 1], source); rels++; }
      }
    }
    if (cursor && cursor !== prev) await setCursor(source, cursor);
    return NextResponse.json({ ok: true, source, found: items.length, written, entities: ents, edges: rels, dropped_as_noise: dropped, graph: await stats() });
  } catch (e) {
    return NextResponse.json({ ok: false, source, error: (e as Error).message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ sources: Object.keys(SOURCES), graph: await stats().catch(() => null) });
}
