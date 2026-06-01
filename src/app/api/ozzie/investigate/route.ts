/**
 * ═══════════════════════════════════════════════════════════════
 *  OZZIE — Autonomous OSINT Investigator (recursive enrichment loop)
 *  POST /api/ozzie/investigate   { target: string, depth?: number }
 *
 *  Ozzie reasons with owl-alpha (OpenRouter, free) in a ReAct loop:
 *  recall MIND → pick the highest-value OSINT tool → observe →
 *  repeat until confident or budget hit → synthesise a cited dossier
 *  → persist it (+ entities) to the @ozzie MIND knowledge graph.
 *
 *  No fabricated facts: every claim traces to a tool observation.
 * ═══════════════════════════════════════════════════════════════
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const OZZIE_MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const OZZIE_FALLBACK_MODEL = process.env.OZZIE_FALLBACK_MODEL || 'anthropic/claude-3.5-haiku';
const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
const SELF_BASE = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const MAX_STEPS = 8;

/* ── OSINT tool registry: name → builds a same-origin GET against our own API ── */
const TOOLS: Record<string, { param: string; path: string; desc: string }> = {
  whois:     { param: 'domain', path: '/api/osint/whois',     desc: 'Domain registration (registrar, dates, nameservers). Input: a domain.' },
  dns:       { param: 'domain', path: '/api/osint/dns',       desc: 'DNS records (A/AAAA/MX/NS/TXT). Input: a domain.' },
  certs:     { param: 'domain', path: '/api/osint/certs',     desc: 'TLS certificate history via crt.sh. Input: a domain.' },
  ip:        { param: 'ip',     path: '/api/osint/ip',        desc: 'IP geolocation + ASN + hosting org. Input: an IPv4/IPv6.' },
  cve:       { param: 'cve',    path: '/api/osint/cve',       desc: 'Vulnerability detail from NVD. Input: a CVE id (CVE-YYYY-NNNNN).' },
  sanctions: { param: 'query',  path: '/api/osint/sanctions', desc: 'OFAC / OpenSanctions screening. Input: a person/org/entity name.' },
};

async function callTool(tool: string, input: string): Promise<unknown> {
  const t = TOOLS[tool];
  if (!t) return { error: `unknown tool: ${tool}` };
  const url = `${SELF_BASE}${t.path}?${t.param}=${encodeURIComponent(input)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await r.json().catch(() => ({ error: 'non-JSON response' }));
    return { status: r.status, data: body };
  } catch (e) {
    return { error: `tool ${tool} failed: ${(e as Error).message}` };
  }
}

async function mindQuery(query: string): Promise<string> {
  if (!MIND_KEY) return 'MIND not configured';
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    return (j as { answer?: string }).answer || 'no prior knowledge';
  } catch { return 'MIND query failed'; }
}

async function mindSaveDossier(title: string, content: string): Promise<string | null> {
  if (!MIND_KEY) return null;
  try {
    const r = await fetch(`${MIND_BASE}/developer/v1/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
      body: JSON.stringify({ title, content, source: 'Ozzie investigation', tags: ['ozzie', 'dossier', 'osint'] }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => ({}));
    return (j as { id?: string }).id || null;
  } catch { return null; }
}

/* ── owl-alpha chat with one cheap fallback (never gemini, never >$15/1M) ── */
async function llm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const tryModel = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://osiris.theastraway.com',
        'X-Title': 'Osiris Ozzie',
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1200 }),
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) throw new Error(`${model} ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || '';
  };
  try { return await tryModel(OZZIE_MODEL); }
  catch { return await tryModel(OZZIE_FALLBACK_MODEL); }
}

const SYSTEM = `You are Ozzie, an autonomous OSINT analyst for the Osiris platform.
Investigate the given target using ONLY the tools provided. NEVER fabricate facts — every claim must come from a tool observation; if a tool returns nothing, record "no data".

Available tools:
${Object.entries(TOOLS).map(([k, v]) => `- ${k}: ${v.desc}`).join('\n')}
- mind_query: recall what the knowledge graph already knows. Input: a question.

Respond with EXACTLY ONE JSON object per turn, no prose around it:
{"thought":"brief reasoning","action":"tool","tool":"<name>","input":"<value>"}
or, when you have enough to report:
{"thought":"...","action":"final","dossier":"<markdown dossier: ## Summary, ## Findings (cite the tool+value for each), ## Risk flags, ## Sources>"}

Start by recalling prior knowledge (mind_query), then fill the highest-value gaps. Be decisive; finish within ${MAX_STEPS} tool calls.`;

function parseAction(raw: string): { action?: string; tool?: string; input?: string; dossier?: string; thought?: string } {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return { action: 'final', dossier: raw }; }
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'Ozzie not configured (OPENROUTER_API_KEY missing)' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const target = (body.target || '').toString().trim();
  if (!target) return NextResponse.json({ error: 'Missing target' }, { status: 400 });

  const transcript: Array<{ role: string; content: string }> = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Investigate this target: ${target}` },
  ];
  const trace: Array<{ step: number; tool?: string; input?: string; thought?: string; observation?: unknown }> = [];

  let dossier = '';
  for (let step = 1; step <= MAX_STEPS; step++) {
    const reply = await llm(transcript);
    const act = parseAction(reply);
    if (act.action === 'final' || !act.tool) { dossier = act.dossier || reply; trace.push({ step, thought: act.thought }); break; }

    const observation = act.tool === 'mind_query'
      ? await mindQuery(act.input || target)
      : await callTool(act.tool, act.input || target);

    trace.push({ step, tool: act.tool, input: act.input, thought: act.thought, observation });
    transcript.push({ role: 'assistant', content: reply });
    transcript.push({ role: 'user', content: `Observation: ${JSON.stringify(observation).slice(0, 4000)}` });

    if (step === MAX_STEPS) {
      transcript.push({ role: 'user', content: 'Budget reached. Output your final dossier JSON now.' });
      dossier = parseAction(await llm(transcript)).dossier || dossier;
    }
  }

  const title = `Ozzie Dossier — ${target} — ${new Date().toISOString().slice(0, 10)}`;
  const docId = await mindSaveDossier(title, dossier);

  return NextResponse.json({ target, dossier, mind_document_id: docId, steps: trace.length, trace });
}
