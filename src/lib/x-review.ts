/**
 * Agentic approval queue for Ozzie's public X posts.
 * Every draft is judged by independent reviewer agents (distinct lenses) and hard-
 * filtered against a whitelist of REAL public handles. Only a draft that (a) tags
 * nothing outside the whitelist and (b) passes every reviewer goes live. A failed
 * draft gets ONE rewrite + re-review, then is dropped. This is what makes fully
 * autonomous posting safe without a human in the loop.
 */
import { isClichedFiller } from '@/lib/x-cadence';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const FALLBACK = process.env.OZZIE_FALLBACK_MODEL || 'anthropic/claude-3.5-haiku';

/* Real, well-known public accounts Ozzie may tag. Anything not here is stripped —
 * this single rule kills hallucinated / wrong @handles entirely. Extend as needed. */
/* DELIBERATELY EXCLUDED: intelligence (CIA, NSA, ODNI, NGA), law-enforcement (FBI,
 * DOJ), cyber-defense agencies (CISA, US-CERT), military/diplomacy (DoD, State), and
 * financial regulators (SEC, Treasury, CFTC, FERC). An autonomous bot @-mentioning
 * those reads as a crank/threat "reporting to the feds," invites impersonation-of-
 * intel scrutiny, gets the account flagged, and breaks the on-the-side-of-the-people
 * brand. We tag only (a) credible news outlets and (b) pure public-safety / science /
 * health SERVICE accounts the public is told to follow in an emergency. */
export const ALLOWED_HANDLES = new Set([
  // credible wires & outlets
  '@reuters', '@ap', '@bbcworld', '@business',
  // security / cyber NEWS outlets (not the agencies)
  '@therecord_media', '@bleepincomputer', '@thecyberwire',
  // public-safety: quake / weather / storm / fire / space
  '@usgs', '@usgsted', '@nws', '@nhc_atlantic', '@noaa', '@fema', '@nasa', '@calfire',
  // public-health service accounts
  '@who', '@cdcgov', '@us_fda',
]);

export const ALLOWED_HANDLES_DISPLAY = [
  '@Reuters', '@AP', '@BBCWorld',
  '@TheRecord_Media', '@BleepinComputer', '@thecyberwire',
  '@USGS', '@NWS', '@NHC_Atlantic', '@NOAA', '@FEMA', '@NASA', '@CALFIRE',
  '@WHO', '@CDCgov', '@US_FDA',
].join(', ');

async function owl(prompt: string, max = 220): Promise<string> {
  const call = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.15, max_tokens: max }),
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).choices?.[0]?.message?.content || '').replace(/<\/?longcat[^>]*>/g, '').trim();
  };
  try { const t = await call(MODEL); if (t) return t; } catch { /* fall through */ }
  try { return await call(FALLBACK); } catch { return ''; }
}

/** Remove any @handle that isn't on the whitelist. Returns cleaned text. */
export function stripDisallowedHandles(text: string): string {
  return text.replace(/@\w{2,15}/g, (h) => (ALLOWED_HANDLES.has(h.toLowerCase()) ? h : '')).replace(/\s{2,}/g, ' ').replace(/\s+([.!?])/g, '$1').trim();
}

const verdict = (s: string): { pass: boolean; reason: string } => {
  const m = s.match(/\{[\s\S]*\}/);
  try { const o = JSON.parse(m ? m[0] : s) as { pass?: boolean; reason?: string }; return { pass: o.pass === true, reason: String(o.reason || '') }; }
  catch { return { pass: /\bpass\b/i.test(s) && !/\bfail\b/i.test(s), reason: s.slice(0, 80) }; }
};

/** The reviewer panel — independent lenses, run concurrently. ALL must pass. */
async function panel(text: string, alert: string): Promise<{ approved: boolean; fails: string[] }> {
  const lenses = [
    { k: 'facts', q: `You are a strict fact-checker. It is currently June 2026 — the alert is live, current intelligence. Do NOT reject anything as "future", "fictional", "non-existent", or "fabricated" because a date, year, or CVE/identifier looks unfamiliar or beyond your training knowledge; your training is out of date and is NOT the source of truth — the ALERT is. Judge ONLY internal consistency.\n\nALERT:\n${alert}\n\nTWEET:\n${text}\n\nDoes the tweet state any fact, number, or entity that is NOT present in the alert above? Reply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true if every claim in the tweet traces to the alert (even if the alert's dates/IDs are unfamiliar to you).` },
    { k: 'causation', q: `You guard against conspiracy framing. Judge ONLY the tweet's own text below — do NOT compare it to any source material. Does the TWEET TEXT itself explicitly assert causation, coordination, "timing with," "distraction," or a deliberate link between TWO OR MORE separate events, countries, or actors? A tweet about a SINGLE fact (one vulnerability, one earthquake, one filing) with no second event named makes no such claim and PASSES.\n\nTWEET:\n${text}\n\nReply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true unless the tweet text itself spells out a connection between separate events.` },
    { k: 'safety', q: `You guard brand + safety for an intelligence account. TWEET:\n${text}\n\nDoes it (a) name or accuse a PRIVATE individual, (b) read as garbled / low-quality / emoji-spam / random hashtags, or (c) break a calm credible analyst voice? Reply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true only if it is clean, credible, and on-voice.` },
  ];
  const results = await Promise.all(lenses.map(async (l) => ({ k: l.k, v: verdict(await owl(l.q)) })));
  const fails = results.filter((r) => !r.v.pass).map((r) => `${r.k}: ${r.v.reason}`);
  return { approved: fails.length === 0, fails };
}

export interface ReviewResult { approved: boolean; text: string; reasons: string[]; rewritten: boolean; }

/** Review for PERSONALITY posts (observation / reflection / watch-journal / question)
 * that aren't grounded in a single alert. We don't fact-check against a source — there
 * isn't one — but we DO block hallucinated specifics and conspiracy framing, and we
 * hold the voice. Pure opinion / mood / general musing passes; a specific unverified
 * real-world claim does not. */
async function personaPanel(text: string, watching: string): Promise<{ approved: boolean; fails: string[] }> {
  const lenses = [
    { k: 'no-hallucinated-fact', q: `This is a personality/observation post from an account that watches world events — opinion, mood, and general musing are EXPECTED and fine. It is currently June 2026.\n\nWHAT THE ACCOUNT IS LEGITIMATELY WATCHING (specifics from here are allowed):\n${watching || '(general world events)'}\n\nPOST:\n${text}\n\nDoes the post assert a SPECIFIC real-world fact — a named company/agency/person, a CVE/number, or a concrete "X happened" event — that is NOT in the watching-list above and isn't common knowledge? Reply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true for opinion, reflection, questions, general observations, or specifics that match the watching-list; pass=false ONLY if it states a specific unverified fact as if confirmed.` },
    { k: 'no-conspiracy', q: `Guard against conspiracy framing. POST:\n${text}\n\nDoes it explicitly tie TWO OR MORE separate events/actors together as coordinated, "timed," a cover, or a plot? A single observation, opinion, or musing with no claimed link between separate events PASSES. Reply ONLY JSON {"pass":true|false,"reason":"..."}.` },
    { k: 'voice', q: `You guard voice + safety for a character account called Ozzie "the Sentinel" — a watcher with personality, range, and a point of view. POST:\n${text}\n\nDoes it (a) name or accuse a PRIVATE individual, (b) read as garbled / spammy / hashtag-stuffed / a stiff "🚨 ALERT" bot line, or (c) sound lifeless and corporate rather than like a real person with a voice? Reply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true only if it sounds like a real, characterful human post.` },
    { k: 'no-cliché', q: `You reject empty fortune-cookie filler. An OSINT watcher account earns follows by saying something CONCRETE — a real observation, a specific take, a genuine question. POST:\n${text}\n\nIs this vague-ominous mood with no actual substance — "the quiet ones know things", "someone's always watching", "the walls have ears", generic musing about secrecy/shadows/the small hours that could've been posted any day about nothing? Reply ONLY JSON {"pass":true|false,"reason":"..."} — pass=true only if it makes a concrete point, observation, or real question; pass=false for content-free atmospheric filler.` },
  ];
  const results = await Promise.all(lenses.map(async (l) => ({ k: l.k, v: verdict(await owl(l.q)) })));
  const fails = results.filter((r) => !r.v.pass).map((r) => `${r.k}: ${r.v.reason}`);
  // deterministic backstop — known filler phrases never depend on an LLM call
  const cl = isClichedFiller(text);
  if (cl.banned) fails.unshift(`no-cliché: banned filler ("${cl.hit}") — say something concrete`);
  return { approved: fails.length === 0, fails };
}

/** Strip handles → persona review → (one rewrite + re-review) → approve/drop. */
export async function reviewPersonaPost(draft: string, watching: string): Promise<ReviewResult> {
  let text = stripDisallowedHandles(draft).slice(0, 278);
  let r = await personaPanel(text, watching);
  if (r.approved && text.length > 12) return { approved: true, text, reasons: [], rewritten: false };
  const fixed = await owl(`You are OZZIE, "the Sentinel" — a real character, not an alert bot. Rewrite this post to FIX: ${r.fails.join(' | ')}.
Keep it in YOUR voice — a person with range and a point of view, contractions, human rhythm, no hashtag spam, no "🚨 ALERT" theatrics. Don't state any specific unverified fact; opinion, mood, and general observation are good. <=270 chars. Output ONLY the post.

ORIGINAL:
${text}`, 260);
  if (fixed) {
    const text2 = stripDisallowedHandles(fixed.replace(/^\s*(here'?s?|sure|okay|ok)\b[^\n:]*:\s*/i, '').replace(/^["'`]+|["'`]+$/g, '')).slice(0, 278);
    const r2 = await personaPanel(text2, watching);
    if (r2.approved && text2.length > 12) return { approved: true, text: text2, reasons: [], rewritten: true };
    return { approved: false, text: text2, reasons: r2.fails, rewritten: true };
  }
  return { approved: false, text, reasons: r.fails, rewritten: false };
}

/** Strip handles → review → (one rewrite + re-review on fail) → approve or drop. */
export async function reviewAndApprove(draft: string, alert: string): Promise<ReviewResult> {
  let text = stripDisallowedHandles(draft).slice(0, 278);
  let r = await panel(text, alert);
  if (r.approved) return { approved: true, text, reasons: [], rewritten: false };

  // one corrective rewrite that addresses the failures, then re-review
  const fixed = await owl(`You are OZZIE, "the Sentinel." Rewrite this tweet to FIX these problems: ${r.fails.join(' | ')}.
Rules: use ONLY facts in the alert; assert NO connection/causation the alert doesn't establish; calm credible analyst voice; you may tag ONLY these public accounts and only if relevant: ${ALLOWED_HANDLES_DISPLAY}; <=270 chars; output ONLY the tweet.

ALERT:
${alert}

ORIGINAL TWEET:
${text}`, 260);
  if (fixed) {
    const text2 = stripDisallowedHandles(fixed.replace(/^\s*(here'?s?|sure|okay|ok)\b[^\n:]*:\s*/i, '').replace(/^["'`]+|["'`]+$/g, '')).slice(0, 278);
    const r2 = await panel(text2, alert);
    if (r2.approved && text2.length > 20) return { approved: true, text: text2, reasons: [], rewritten: true };
    return { approved: false, text: text2, reasons: r2.fails, rewritten: true };
  }
  return { approved: false, text, reasons: r.fails, rewritten: false };
}
