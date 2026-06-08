/**
 * Ozzie X cadence + de-duplication gate.
 *
 * The x-post cron fires often (n8n schedule) and the agentic panel approves any
 * individually-plausible draft — which let Ozzie post the SAME story (one CVE, one
 * "watchtower" musing) over and over, reading like a looping bot. This module is the
 * discipline layer that makes every post earn its slot:
 *
 *   1. canPostNow()   — min-gap + daily-cap throttle (the cadence the n8n schedule lacks)
 *   2. isDuplicate()  — token-trigram Jaccard vs recent posts + per-topic cooldown
 *   3. isClichedFiller() — hard reject of the vague-ominous fortune-cookie lines
 *   4. recordPost()   — append a confirmed publish to the rolling history
 *
 * State is a flat JSON file under OSIRIS_DATA_DIR (same idiom as x-post/route.ts and
 * sentinel.ts). Every read is FAIL-OPEN: a missing/corrupt state file must never be able
 * to silence Ozzie — a dead account is as bad as a spam account.
 */
import fs from 'fs/promises';

const DIR = process.env.OSIRIS_DATA_DIR || '/data';
const STATE = `${DIR}/x_cadence.json`;

// Tunables (env-overridable; these defaults are the source of truth — the n8n schedule
// is only coarse pacing on top of this).
export const MIN_GAP_MIN = Number(process.env.OZZIE_X_MIN_GAP_MIN || 180); // ≥3h between posts
export const DAILY_CAP = Number(process.env.OZZIE_X_DAILY_CAP || 5);       // max posts / 24h
export const SIM_THRESHOLD = Number(process.env.OZZIE_X_SIM_THRESHOLD || 0.55);
export const TOPIC_COOLDOWN_H = Number(process.env.OZZIE_X_TOPIC_COOLDOWN_H || 48);
const DUP_WINDOW = 30;   // compare against the last N posts
const KEEP = 200;        // rolling history length

interface PostRec { at: number; topic: string; norm: string }
interface State { posts: PostRec[] }

async function read(): Promise<State> {
  try { const s = JSON.parse(await fs.readFile(STATE, 'utf8')); return { posts: Array.isArray(s.posts) ? s.posts : [] }; }
  catch { return { posts: [] }; } // fail-open
}
async function write(s: State): Promise<void> {
  try { await fs.mkdir(DIR, { recursive: true }); } catch { /* exists */ }
  try { await fs.writeFile(STATE, JSON.stringify({ posts: s.posts.slice(-KEEP) })); } catch { /* best-effort */ }
}

/** Lowercase, drop urls/@handles/punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s: string): Set<string> {
  const toks = normalize(s).split(' ').filter(Boolean);
  const g = new Set<string>();
  if (toks.length < 3) { toks.forEach((t) => g.add(t)); return g; }
  for (let i = 0; i <= toks.length - 3; i++) g.add(toks.slice(i, i + 3).join(' '));
  return g;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Pull a stable topic key from a draft: a CVE id if present, else the supplied fallback.
 * This stops the same CVE re-posting under different dominant-entity keys. */
export function topicOf(text: string, fallback: string): string {
  const cve = text.match(/CVE-\d{4}-\d{4,7}/i);
  return cve ? cve[0].toUpperCase() : fallback;
}

/** Throttle: false if the last post is too recent or the 24h cap is hit. Fail-open. */
export async function canPostNow(opts?: { minGapMin?: number; dailyCap?: number }): Promise<{ ok: boolean; reason?: string; nextInMin?: number }> {
  const minGapMin = opts?.minGapMin ?? MIN_GAP_MIN;
  const dailyCap = opts?.dailyCap ?? DAILY_CAP;
  const { posts } = await read();
  if (!posts.length) return { ok: true };
  const now = Date.now();
  const last = posts[posts.length - 1].at;
  const sinceMin = (now - last) / 60000;
  if (sinceMin < minGapMin) return { ok: false, reason: `min-gap ${Math.round(sinceMin)}/${minGapMin}m`, nextInMin: Math.ceil(minGapMin - sinceMin) };
  const in24h = posts.filter((p) => now - p.at < 86400000).length;
  if (in24h >= dailyCap) return { ok: false, reason: `daily-cap ${in24h}/${dailyCap}`, nextInMin: Math.ceil((86400000 - (now - posts[posts.length - in24h].at)) / 60000) };
  return { ok: true };
}

/** True if the draft is too similar to a recent post, or re-hits a topic still on cooldown. Fail-open. */
export async function isDuplicate(text: string, opts?: { topic?: string; threshold?: number; topicCooldownH?: number }): Promise<{ dup: boolean; reason?: string }> {
  const threshold = opts?.threshold ?? SIM_THRESHOLD;
  const topicCooldownH = opts?.topicCooldownH ?? TOPIC_COOLDOWN_H;
  const { posts } = await read();
  if (!posts.length) return { dup: false };
  const now = Date.now();
  if (opts?.topic) {
    const hit = posts.find((p) => p.topic === opts.topic && now - p.at < topicCooldownH * 3600000);
    if (hit) return { dup: true, reason: `topic "${opts.topic}" within ${topicCooldownH}h cooldown` };
  }
  const g = trigrams(text);
  let max = 0;
  for (const p of posts.slice(-DUP_WINDOW)) max = Math.max(max, jaccard(g, trigrams(p.norm)));
  if (max >= threshold) return { dup: true, reason: `text ${(max * 100).toFixed(0)}% similar to a recent post` };
  return { dup: false };
}

/** Hard, deterministic reject of the vague-ominous fortune-cookie filler Ozzie kept emitting. */
const BANNED: RegExp[] = [
  /bodies are buried/i,
  /walls have ears/i,
  /the quiet ones/i,
  /thinn?est walls/i,
  /watchtower/i,
  /never (looks?|sleeps?) away|never looks? away|who never sleeps/i,
  /someone'?s always (watching|one (commit|step) ahead)/i,
  /in the (small|quiet) hours/i,
  /the (quiet )?hum of/i,
];
export function isClichedFiller(text: string): { banned: boolean; hit?: string } {
  for (const re of BANNED) { const m = text.match(re); if (m) return { banned: true, hit: m[0] }; }
  return { banned: false };
}

/** Record a CONFIRMED publish (call only after a real post succeeds). */
export async function recordPost(text: string, topic: string): Promise<void> {
  const s = await read();
  s.posts.push({ at: Date.now(), topic, norm: normalize(text) });
  await write(s);
}
