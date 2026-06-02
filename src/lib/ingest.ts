/**
 * Continuous OSINT ingestion → Ozzie's MIND knowledge graph.
 * Each source fetches new public-record items, dedups against a cursor, and POSTs
 * well-structured documents to the @ozzie tenant — MIND's KG does the entity
 * extraction + linking. Volume is capped per run so we never flood ingestion.
 */
import fs from 'fs/promises';

const DIR = process.env.OSIRIS_DATA_DIR || '/data';
const STATE_PATH = `${DIR}/ingest_state.json`;
const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';

export async function getState(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')); } catch { return {}; }
}
export async function setCursor(source: string, cursor: string): Promise<void> {
  const s = await getState(); s[source] = cursor;
  try { await fs.mkdir(DIR, { recursive: true }); } catch { /* exists */ }
  await fs.writeFile(STATE_PATH, JSON.stringify(s));
}

/** POST one structured document into the @ozzie knowledge graph. */
export async function postDoc(title: string, content: string, tags: string[]): Promise<boolean> {
  if (!MIND_KEY) return false;
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ title, content, source: 'Ozzie ingestion', tags }),
      signal: AbortSignal.timeout(120000),
    });
    return r.ok;
  } catch { return false; }
}

/** Ingest a capped batch sequentially; returns how many landed. */
export async function ingestBatch(items: Array<{ title: string; content: string; tags: string[] }>, cap = 10): Promise<number> {
  let n = 0;
  for (const it of items.slice(0, cap)) {
    if (await postDoc(it.title, it.content, it.tags)) n++;
  }
  return n;
}
