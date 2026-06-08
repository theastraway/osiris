/**
 * POST /api/ozzie/cron/x-post  (X-Cron-Secret or x-ozzie-service)
 * Ozzie posts to X like a PERSON, not an alert feed. Each cycle it picks a post MODE —
 * mostly personality (observation / reflection / watch-journal / question), with a
 * grounded SIGNAL drop only ~1 in 5 and only when the feed genuinely warrants it. Every
 * draft clears an agentic review (voice + no-hallucinated-fact + no-conspiracy, or full
 * fact-grounding for signal posts) and a hard handle whitelist before it can go live.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { readFeed, type Fire } from '@/lib/sentinel';
import { publish, channels } from '@/lib/blotato';
import { logRun } from '@/lib/runlog';
import { OZZIE_PERSONA_SHORT } from '@/lib/persona';
import { reviewAndApprove, reviewPersonaPost, ALLOWED_HANDLES_DISPLAY } from '@/lib/x-review';
import { canPostNow, isDuplicate, isClichedFiller, recordPost, topicOf } from '@/lib/x-cadence';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DIR = process.env.OSIRIS_DATA_DIR || '/data';
const POSTED = `${DIR}/x_posted.json`;
const MODEFILE = `${DIR}/x_mode_counter.json`;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const FALLBACK = process.env.OZZIE_FALLBACK_MODEL || 'anthropic/claude-3.5-haiku';
const AUTOPOST = process.env.OZZIE_X_AUTOPOST === '1';        // dark by default
const OZZIE_X_ACCOUNT = process.env.BLOTATO_ACCOUNT_OZZIE_X || ''; // @ozzie_ai in Blotato
const SEV: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

// Post-mode rotation — weighted toward personality so Ozzie reads as a character, not a
// SIEM. signal = 2/10 cycles (and only if a fresh strong alert exists, else → reflection).
// Weighted toward CONCRETE, followable posts (observation + question), signal held at
// 2/10, and the cliché-prone vague modes (reflection / watch-journal) cut to 1 each.
const MODES = ['observation', 'question', 'signal', 'observation', 'reflection', 'observation', 'question', 'signal', 'watch-journal', 'observation'];

const keyOf = (f: Fire) => {
  const a = [...f.entities].sort((x, y) => y.length - x.length)[0];
  return a ? `${f.channel}:${a.toLowerCase().replace(/[^a-z0-9]/g, '')}`
    : `${f.channel}:${(f.headline.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 4).sort()[0] || 'x'}`;
};
async function postedKeys(): Promise<string[]> { try { return JSON.parse(await fs.readFile(POSTED, 'utf8')); } catch { return []; } }
async function markPosted(keys: string[]): Promise<void> { try { await fs.mkdir(DIR, { recursive: true }); } catch {} await fs.writeFile(POSTED, JSON.stringify(keys.slice(-800))); }
async function nextMode(): Promise<string> {
  let n = 0; try { n = (JSON.parse(await fs.readFile(MODEFILE, 'utf8')).n as number) || 0; } catch { /* fresh */ }
  try { await fs.mkdir(DIR, { recursive: true }); } catch {}
  await fs.writeFile(MODEFILE, JSON.stringify({ n: n + 1 }));
  return MODES[n % MODES.length];
}

async function owl(prompt: string, temp = 0.85): Promise<string> {
  const call = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: temp, max_tokens: 400 }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).choices?.[0]?.message?.content || '').replace(/<\/?longcat[^>]*>/g, '').trim();
  };
  try { const t = await call(MODEL); if (t) return t; } catch { /* fall through */ }
  try { return await call(FALLBACK); } catch { return ''; }
}

const clean = (s: string) => s.replace(/^\s*(here'?s?|sure|okay|ok)\b[^\n:]*:\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 278);

// Per-mode drafting. Personality modes get the feed only as "texture" (what Ozzie's been
// watching) — never to be quoted as breaking fact. signal mode is grounded in one alert.
function personaPrompt(mode: string, watching: string): string {
  const base = `${OZZIE_PERSONA_SHORT}\n\nWrite ONE X post (max 270 chars) as yourself. Output ONLY the post text — no preamble, no quotes, no "Here's".`;
  const texture = watching ? `\n\nWHAT YOU'VE BEEN WATCHING LATELY (texture only — your week's backdrop; do NOT quote any of it as a breaking fact, and never tie two of these together into a plot):\n${watching}` : '';
  const m: Record<string, string> = {
    observation: `Post a sharp, human OBSERVATION — a take on the state of things, on watching the world, on what people miss. Your point of view, your voice. It can be wry, blunt, or quietly fascinated. Not news, not an alert — a thought worth following you for.`,
    reflection: `Post a short, human REFLECTION — a wry or pointed thought about secrecy, power, the small hours, or being the thing that never looks away. Character over content. No specific factual claim — this is pure voice.`,
    'watch-journal': `Post a WATCH-JOURNAL line — first person, atmospheric: what it feels like watching the open world right now, from the watchtower. A window into the vigil. Mood, not a report.`,
    question: `Ask the timeline a real QUESTION you're genuinely curious about as a watcher of the world. Conversational, human, invites replies. Not a poll gimmick, not rhetorical filler.`,
  };
  return `${base}${texture}\n\n${m[mode] || m.observation}`;
}

export async function POST(req: NextRequest) {
  const cronOk = !!process.env.CRON_SECRET && req.headers.get('x-cron-secret') === process.env.CRON_SECRET;
  const n8nOk = !!process.env.OZZIE_N8N_TOKEN && req.headers.get('x-ozzie-service') === process.env.OZZIE_N8N_TOKEN;
  if (!cronOk && !n8nOk) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // ── CADENCE GATE — short-circuit BEFORE any owl spend when we're live. Min-gap +
  // daily-cap are the throttle the n8n schedule lacks; dry-run still drafts for review.
  if (AUTOPOST) {
    const gate = await canPostNow();
    if (!gate.ok) {
      await logRun('x-post', true, `THROTTLED · ${gate.reason} · next ~${gate.nextInMin}m`);
      return NextResponse.json({ ok: true, throttled: true, reason: gate.reason, nextInMin: gate.nextInMin });
    }
  }

  const feed = await readFeed(120);
  const seen = new Set(await postedKeys());
  // strongest unposted, grounded, single-domain signal (black-swan excluded from X)
  const ranked = feed
    .filter((f) => !seen.has(keyOf(f)) && f.channel !== 'black-swan')
    .map((f) => ({ f, score: (SEV[f.severity] || 1) * (f.confidence || 0.5) + (f.analysis?.matters ? 0.4 : 0) }))
    .sort((a, b) => b.score - a.score);
  const topSignal = ranked[0]?.f;
  // texture for personality posts: a few recent headlines, no analysis dump
  const watching = feed.slice(0, 6).map((f) => `• ${f.headline}`).join('\n');

  let mode = await nextMode();
  // signal mode only fires with a genuinely strong fresh alert; else Ozzie just talks
  if (mode === 'signal' && (!topSignal || (SEV[topSignal.severity] || 1) < 2)) mode = 'reflection';

  // ── SIGNAL: grounded in one real alert, written like a person who just noticed it ──
  if (mode === 'signal' && topSignal) {
    const a = topSignal.analysis;
    const draft = clean(await owl(`${OZZIE_PERSONA_SHORT}

Something real just crossed your feed. Post it like a PERSON who just noticed something everyone else scrolled past — plain, sharp, a touch of your voice. NOT a security scanner, NO "🚨 ALERT", no hashtag spam.
- Post ONLY the single concrete core fact below. If the alert carries any cross-event / "timed with" / geopolitical-timing framing, IGNORE it — one fact, stated like a human.
- You may tag 0-1 accounts ONLY from this exact list if genuinely relevant: ${ALLOWED_HANDLES_DISPLAY}. Tag nothing else. Never a private individual.
- Output ONLY the post.

THE SIGNAL [${topSignal.severity}]:
${topSignal.headline}
${a ? `What it means: ${a.means}` : `Pattern: ${topSignal.pattern}`}
Entities: ${topSignal.entities.join(', ')}`, 0.7));
    if (!draft) { await logRun('x-post', true, 'owl empty (signal)'); return NextResponse.json({ ok: true, skipped: 'no draft', mode }); }
    const alertSummary = `${topSignal.headline} | ${a ? `means: ${a.means}; ` : ''}entities: ${topSignal.entities.join(', ')}`;
    const review = await reviewAndApprove(draft, alertSummary);
    await markPosted([...seen, keyOf(topSignal)]);
    return finish(review.approved, review.text, mode, topSignal.channel, review.rewritten, review.reasons, topicOf(review.text, keyOf(topSignal)));
  }

  // ── PERSONALITY: observation / reflection / watch-journal / question ──
  const draft = clean(await owl(personaPrompt(mode, watching)));
  if (!draft) { await logRun('x-post', true, `owl empty (${mode})`); return NextResponse.json({ ok: true, skipped: 'no draft', mode }); }
  const review = await reviewPersonaPost(draft, watching);
  return finish(review.approved, review.text, mode, mode, review.rewritten, review.reasons, topicOf(review.text, `persona:${mode}`));
}

async function finish(approved: boolean, text: string, mode: string, label: string, rewritten: boolean, reasons: string[], topic: string) {
  if (!approved) {
    await logRun('x-post', true, `REJECTED (${mode}) · ${reasons.join('; ').slice(0, 90)}`);
    return NextResponse.json({ ok: true, approved: false, mode, reasons, draft: text });
  }
  // ── DEDUP + CLICHÉ GATE — last line of defense before a live post. Kills near-identical
  // restatements (same CVE / same musing) and the vague-ominous filler. Fail-open inside.
  const filler = isClichedFiller(text);
  const dup = approved ? await isDuplicate(text, { topic }) : { dup: false as const };
  if (filler.banned || dup.dup) {
    const why = filler.banned ? `cliché: ${filler.hit}` : `dup: ${dup.reason}`;
    await logRun('x-post', true, `SUPPRESSED (${mode}) · ${why} · ${text.slice(0, 50)}`);
    return NextResponse.json({ ok: true, approved: false, suppressed: true, mode, reasons: [why], post: text });
  }
  let posted = false;
  if (AUTOPOST) {
    const ch = OZZIE_X_ACCOUNT
      ? { id: 'ozzie_x', label: 'Ozzie · X', platform: 'twitter', accountId: OZZIE_X_ACCOUNT }
      : channels().find((c) => c.platform === 'twitter');
    if (ch) { const r = await publish(ch, text); posted = r.ok; if (posted) await recordPost(text, topic); }
  }
  await logRun('x-post', true, `${AUTOPOST ? (posted ? 'POSTED' : 'post-failed') : 'APPROVED(dry)'} · ${mode}${rewritten ? ' (rewritten)' : ''} · ${text.slice(0, 60)}`);
  return NextResponse.json({ ok: true, approved: true, mode, mode_label: label, posted: AUTOPOST ? posted : undefined, dryRun: !AUTOPOST, rewritten, post: text });
}
