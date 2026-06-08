/**
 * Ozzie graph store — our own Postgres (DO1), so the intelligence graph runs on
 * FREE owl + free storage and costs ~zero MIND credits at any scale.
 *   items      — every Sense-processed intelligence item (full-text searchable)
 *   entities   — canonical resolved nodes (org/person/cve/…); merged by name+type
 *   edges      — relationships between entities (with provenance)
 *   dossiers   — living, self-updating per-entity intelligence profiles
 */
import { Pool } from 'pg';

const url = process.env.DATABASE_URL || `postgres://osiris:${process.env.POSTGRES_PASSWORD || 'changeme'}@postgres:5432/osiris`;
let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30000 });
  return pool;
}

async function init(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS items (
      id text PRIMARY KEY, source text, title text, content text,
      significance real DEFAULT 0.5, ts timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS items_fts ON items USING gin(to_tsvector('english', coalesce(title,'')||' '||coalesce(content,'')));
    CREATE INDEX IF NOT EXISTS items_ts ON items(ts DESC);
    CREATE TABLE IF NOT EXISTS entities (
      id bigserial PRIMARY KEY, name text, type text, norm text,
      attrs jsonb DEFAULT '{}', mentions int DEFAULT 1,
      first_seen timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now(),
      UNIQUE(norm, type)
    );
    CREATE INDEX IF NOT EXISTS entities_last ON entities(last_seen DESC);
    CREATE INDEX IF NOT EXISTS entities_mentions ON entities(mentions DESC);
    CREATE TABLE IF NOT EXISTS edges (
      id bigserial PRIMARY KEY, src text, rel text, dst text, source text, ts timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dossiers (
      entity text PRIMARY KEY, type text, content text, confidence real DEFAULT 0.5,
      cross_domain int DEFAULT 0, updated timestamptz DEFAULT now()
    );
  `);
}
export async function db(): Promise<Pool> { if (!ready) ready = init(); await ready; return getPool(); }

export async function insertItem(it: { id: string; source: string; title: string; content: string; significance: number }): Promise<boolean> {
  const p = await db();
  const r = await p.query('INSERT INTO items(id,source,title,content,significance) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING', [it.id, it.source, it.title.slice(0, 300), it.content.slice(0, 8000), it.significance]);
  return (r.rowCount || 0) > 0;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200);
export async function upsertEntity(name: string, type: string): Promise<void> {
  if (!name || name.length < 2) return;
  const p = await db();
  await p.query(`INSERT INTO entities(name,type,norm) VALUES($1,$2,$3)
    ON CONFLICT(norm,type) DO UPDATE SET mentions=entities.mentions+1, last_seen=now(), name=EXCLUDED.name`, [name.slice(0, 200), type.slice(0, 40), norm(name)]);
}
export async function insertEdge(src: string, rel: string, dst: string, source: string): Promise<void> {
  if (!src || !dst) return;
  const p = await db();
  await p.query('INSERT INTO edges(src,rel,dst,source) VALUES($1,$2,$3,$4)', [src.slice(0, 200), rel.slice(0, 80), dst.slice(0, 200), source]);
}
export async function searchItems(q: string, limit = 12): Promise<Array<{ title: string; content: string; source: string; ts: string }>> {
  const p = await db();
  const r = await p.query(
    `SELECT title,content,source,ts FROM items WHERE to_tsvector('english', coalesce(title,'')||' '||coalesce(content,'')) @@ plainto_tsquery('english',$1)
     ORDER BY significance DESC, ts DESC LIMIT $2`, [q, limit]);
  return r.rows;
}
export async function recentItems(limit = 30): Promise<Array<{ title: string; content: string; source: string }>> {
  const p = await db();
  const r = await p.query('SELECT title,content,source FROM items ORDER BY ts DESC LIMIT $1', [limit]);
  return r.rows;
}
export async function topEntities(limit = 15): Promise<Array<{ name: string; type: string; mentions: number }>> {
  const p = await db();
  const r = await p.query('SELECT name,type,mentions FROM entities ORDER BY mentions DESC, last_seen DESC LIMIT $1', [limit]);
  return r.rows;
}
export async function upsertDossier(entity: string, type: string, content: string, confidence: number, crossDomain: number): Promise<void> {
  const p = await db();
  await p.query(`INSERT INTO dossiers(entity,type,content,confidence,cross_domain,updated) VALUES($1,$2,$3,$4,$5,now())
    ON CONFLICT(entity) DO UPDATE SET content=EXCLUDED.content, confidence=EXCLUDED.confidence, cross_domain=EXCLUDED.cross_domain, updated=now()`, [entity.slice(0, 200), type, content, confidence, crossDomain]);
}
export async function getDossier(entity: string): Promise<{ content: string; updated: string } | null> {
  const p = await db();
  const r = await p.query('SELECT content,updated FROM dossiers WHERE lower(entity)=lower($1) LIMIT 1', [entity]);
  return r.rows[0] || null;
}
export async function stats(): Promise<{ items: number; entities: number; edges: number; dossiers: number }> {
  const p = await db();
  const r = await p.query('SELECT (SELECT count(*) FROM items) items,(SELECT count(*) FROM entities) entities,(SELECT count(*) FROM edges) edges,(SELECT count(*) FROM dossiers) dossiers');
  return r.rows[0];
}
