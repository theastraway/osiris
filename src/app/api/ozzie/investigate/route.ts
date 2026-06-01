/**
 * ═══════════════════════════════════════════════════════════════
 *  OZZIE — Autonomous OSINT Investigator (recursive enrichment loop)
 *  POST /api/ozzie/investigate   { target: string }
 *
 *  Two-phase, robust by design:
 *   1. TOOL LOOP — owl-alpha emits compact JSON tool calls; Ozzie
 *      recalls MIND, then drives OSINT tools until confident/budget.
 *   2. SYNTHESIS — a dedicated call turns the observations into a
 *      plain-markdown cited dossier (no JSON parsing of prose).
 *  Dossier + entities persist to the @ozzie MIND graph (background).
 *  No fabricated facts: every claim traces to a tool observation.
 * ═══════════════════════════════════════════════════════════════
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { verifySession, PRO_COOKIE } from '@/lib/billing';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const OZZIE_MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const OZZIE_FALLBACK_MODEL = process.env.OZZIE_FALLBACK_MODEL || 'anthropic/claude-3.5-haiku';
const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const SELF_BASE = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const MAX_STEPS = 5; // owl-alpha ~15-20s/call; keep total investigation under ~90s

const TOOLS: Record<string, { param: string; path: string; desc: string }> = {
  whois:     { param: 'domain', path: '/api/osint/whois',     desc: 'Domain registration (registrar, dates, nameservers). Input: a domain.' },
  dns:       { param: 'domain', path: '/api/osint/dns',       desc: 'DNS records (A/AAAA/MX/NS/TXT). Input: a domain.' },
  certs:     { param: 'domain', path: '/api/osint/certs',     desc: 'TLS certificate history via crt.sh. Input: a domain.' },
  ip:        { param: 'ip',     path: '/api/osint/ip',        desc: 'IP geolocation + ASN + hosting org. Input: an IPv4/IPv6.' },
  cve:       { param: 'cve',    path: '/api/osint/cve',       desc: 'Vulnerability detail from NVD. Input: a CVE id.' },
  sanctions: { param: 'query',  path: '/api/osint/sanctions', desc: 'OFAC / OpenSanctions screening. Input: a person/org name.' },
};

async function callTool(tool: string, input: string): Promise<unknown> {
  const t = TOOLS[tool];
  if (!t) return { error: `unknown tool: ${tool}` };
  try {
    const r = await fetch(`${SELF_BASE}${t.path}?${t.param}=${encodeURIComponent(input)}`, { signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json().catch(() => ({ error: 'non-JSON' })) };
  } catch (e) { return { error: `tool ${tool} failed: ${(e as Error).message}` }; }
}

async function mindQuery(query: string): Promise<string> {
  if (!MIND_KEY) return 'MIND not configured';
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(30000),
    });
    return ((await r.json().catch(() => ({}))) as { answer?: string }).answer || 'no prior knowledge';
  } catch { return 'MIND query failed'; }
}

async function mindSaveDossier(title: string, content: string): Promise<void> {
  if (!MIND_KEY) return;
  try {
    await fetch(`${MIND_BASE}/developer/v1/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ title, content, source: 'Ozzie investigation', tags: ['ozzie', 'dossier', 'osint'] }),
      signal: AbortSignal.timeout(90000),
    });
  } catch { /* best-effort background persist */ }
}

async function llm(messages: Array<{ role: string; content: string }>, maxTokens = 700): Promise<string> {
  const tryModel = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`${model} ${r.status}`);
    return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
  };
  try { return await tryModel(OZZIE_MODEL); } catch { return await tryModel(OZZIE_FALLBACK_MODEL); }
}

/* Lenient extraction of a {tool,input} or done signal — never throws. */
function parseStep(raw: string): { tool?: string; input?: string; done?: boolean } {
  if (/"done"\s*:\s*true|\bDONE\b/i.test(raw)) return { done: true };
  let s = raw; const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) s = f[1];
  try {
    const st = s.indexOf('{'), en = s.indexOf('}', st);
    if (st >= 0 && en > st) { const o = JSON.parse(s.slice(st, en + 1)); if (o.tool) return { tool: o.tool, input: String(o.input ?? '') }; if (o.done) return { done: true }; }
  } catch { /* regex fallback */ }
  const tm = s.match(/"tool"\s*:\s*"([a-z_]+)"/i); const im = s.match(/"input"\s*:\s*"([^"]*)"/);
  if (tm) return { tool: tm[1], input: im ? im[1] : '' };
  return { done: true };
}

const SYSTEM = `You are Ozzie, an autonomous OSINT analyst for the Osiris platform. Investigate the target using ONLY these tools — NEVER fabricate facts.

Tools (respond with ONE compact JSON object, single line, no prose):
- mind_query  → recall the knowledge graph. {"tool":"mind_query","input":"<question>"}
${Object.entries(TOOLS).map(([k, v]) => `- ${k}  → ${v.desc} {"tool":"${k}","input":"<value>"}`).join('\n')}

Start with mind_query, then fill the highest-value gaps. When you have enough, respond with {"done":true}. Finish within ${MAX_STEPS} calls.`;

export async function POST(req: NextRequest) {
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'Ozzie not configured (OPENROUTER_API_KEY missing)' }, { status: 503 });
  // Pro gate — investigations are a paid feature ($49/mo), comp, or internal cron/service.
  const isService = Boolean(process.env.CRON_SECRET) && req.headers.get('x-ozzie-service') === process.env.CRON_SECRET;
  if (!isService && !verifySession(req.cookies.get(PRO_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Osiris Pro required', upgrade: '/ozzie' }, { status: 402 });
  }
  const body = await req.json().catch(() => ({}));
  const target = (body.target || '').toString().trim();
  if (!target) return NextResponse.json({ error: 'Missing target' }, { status: 400 });

  const transcript: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Investigate this target: ${target}` },
  ];
  const trace: Array<{ step: number; tool: string; input: string; observation?: unknown }> = [];

  // ── Phase 1: tool loop ──
  for (let step = 1; step <= MAX_STEPS; step++) {
    const reply = await llm(transcript, 400);
    const act = parseStep(reply);
    if (act.done || !act.tool) break;
    const observation = act.tool === 'mind_query' ? await mindQuery(act.input || target) : await callTool(act.tool, act.input || target);
    trace.push({ step, tool: act.tool, input: act.input || target, observation });
    transcript.push({ role: 'assistant', content: reply });
    transcript.push({ role: 'user', content: `Observation: ${JSON.stringify(observation).slice(0, 3500)}` });
  }

  // ── Phase 2: synthesis (plain markdown, no JSON) ──
  const dossier = await llm([
    ...transcript,
    { role: 'user', content: `Write the final intelligence dossier on "${target}" as MARKDOWN ONLY (no JSON, no code fences). Use these sections: ## Summary, ## Findings (cite the tool + value behind each fact), ## Risk Flags, ## Sources. Base every claim strictly on the observations above; if something is unknown, say so.` },
  ], 1400);

  const title = `Ozzie Dossier - ${target} - ${new Date().toISOString().slice(0, 10)}`;
  after(async () => { await mindSaveDossier(title, dossier); });

  return NextResponse.json({ target, dossier, persisted_to_mind: Boolean(MIND_KEY), steps: trace.length, trace });
}
