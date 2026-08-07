/**
 * POST /api/ozzie/chat  { messages: [{role,content}] }
 * Conversational Ozzie that OPERATES Ozzie. owl-alpha runs a ReAct tool loop with
 * access to the full surface — investigate, monitors, watchlist, alert settings —
 * and executes them on your behalf, then replies in plain language.
 * Pro-gated (it drives Pro capabilities).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, PRO_COOKIE } from '@/lib/billing';
import { listMonitors, saveMonitors, parseMonitor, type Monitor } from '@/lib/monitors';
import { getWatchlist, setWatchlist, getSettings, setSettings } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 200;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/free';
const FALLBACK = process.env.OZZIE_FALLBACK_MODEL || 'openrouter/free';
const SELF = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const newId = () => `m_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/* ── Tools Ozzie can call on itself ── */
const TOOLS = `- investigate {"target":"<domain/ip/org/person>"} — run a full OSINT investigation, returns a cited dossier.
- add_monitor {"text":"<plain english, e.g. active fires in the USA>"} — start watching a live feed.
- list_monitors {} — list active monitors.
- remove_monitor {"id_or_label":"<id or label>"} — stop a monitor.
- add_watchlist {"target":"<entity>"} — add a target to the daily-rescanned watchlist.
- list_watchlist {} — list watchlist targets.
- remove_watchlist {"target":"<entity>"} — remove a watchlist target.
- set_alert_email {"email":"<address>"} — set where alerts are sent.
- get_settings {} — show current alert settings.`;

async function exec(tool: string, args: Record<string, string>): Promise<{ obs: string; dossier?: string }> {
  try {
    switch (tool) {
      case 'investigate': {
        const r = await fetch(`${SELF}/api/ozzie/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ozzie-service': process.env.CRON_SECRET || '' }, body: JSON.stringify({ target: args.target }), signal: AbortSignal.timeout(190000) });
        const d = await r.json(); return { obs: `Dossier for ${args.target}:\n${(d.dossier || 'no result').slice(0, 2500)}`, dossier: d.dossier };
      }
      case 'add_monitor': {
        const cfg = await parseMonitor(args.text || ''); if (!cfg) return { obs: "Couldn't interpret that monitor. Ask for fires or earthquakes." };
        const m: Monitor = { id: newId(), label: cfg.label, type: cfg.type as Monitor['type'], params: cfg.params as Monitor['params'], cooldownMin: 180, lastAlert: 0, state: {} };
        await saveMonitors([...(await listMonitors()), m]); return { obs: `Monitor added: "${m.label}" (${m.type}). Checked every ~20 min.` };
      }
      case 'list_monitors': { const m = await listMonitors(); return { obs: m.length ? m.map((x) => `- ${x.label} [${x.type}] id=${x.id}`).join('\n') : 'No monitors.' }; }
      case 'remove_monitor': { const list = await listMonitors(); const key = (args.id_or_label || '').toLowerCase(); const next = list.filter((x) => x.id.toLowerCase() !== key && x.label.toLowerCase() !== key); await saveMonitors(next); return { obs: next.length < list.length ? 'Monitor removed.' : 'No matching monitor.' }; }
      case 'add_watchlist': { const t = (args.target || '').toLowerCase().trim(); if (!t) return { obs: 'Need a target.' }; await setWatchlist([...(await getWatchlist()), t]); return { obs: `Added ${t} to the watchlist.` }; }
      case 'list_watchlist': { const w = await getWatchlist(); return { obs: w.length ? w.join(', ') : 'Watchlist is empty.' }; }
      case 'remove_watchlist': { const t = (args.target || '').toLowerCase().trim(); const w = await getWatchlist(); await setWatchlist(w.filter((x) => x !== t)); return { obs: `Removed ${t}.` }; }
      case 'set_alert_email': { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email || '')) return { obs: 'That email looks invalid.' }; const s = await setSettings({ alertEmail: args.email }); return { obs: `Alerts now go to ${s.alertEmail}.` }; }
      case 'get_settings': { const s = await getSettings(); return { obs: `Alert email: ${s.alertEmail}; channels: ${Object.entries(s.channels).filter(([, v]) => v).map(([k]) => k).join(', ')}; monitor cadence: every ~${s.monitorCadenceMin} min.` }; }
      default: return { obs: `Unknown tool ${tool}` };
    }
  } catch (e) { return { obs: `Tool ${tool} failed: ${(e as Error).message}` }; }
}

async function llm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const call = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700 }), signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`${model} ${r.status}`); return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
  };
  try { return await call(MODEL); } catch { return await call(FALLBACK); }
}

const SYSTEM = `You are Ozzie — a sharp, concise autonomous OSINT analyst. You can OPERATE yourself for the user via tools.
To use a tool, reply with ONE JSON object on its own line and nothing else: {"tool":"<name>","args":{...}}
Tools:
${TOOLS}
After a tool runs you receive its result, then continue. When you're done, reply to the user in plain, friendly language (no JSON). Be brief. If the user just chats, answer directly. When you investigate, summarise the key findings and risk flags conversationally — don't dump raw JSON.`;

function parseTool(s: string): { tool?: string; args?: Record<string, string> } {
  const t = s.trim();
  // owl-alpha (longcat) native tool-call syntax
  const lc = t.match(/<longcat_tool_call>\s*([\s\S]*?)<\/longcat_tool_call>/);
  if (lc) {
    const inner = lc[1].trim();
    const name = (inner.split(/[\s<]/)[0] || '').trim();
    const args: Record<string, string> = {};
    const re = /<longcat_arg_key>\s*([\s\S]*?)\s*<\/longcat_arg_key>\s*<longcat_arg_value>\s*([\s\S]*?)\s*<\/longcat_arg_value>/g;
    let m; while ((m = re.exec(inner))) args[m[1].trim()] = m[2].trim();
    if (name) return { tool: name, args };
  }
  // generic JSON tool-call
  let j = t; const f = j.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) j = f[1].trim();
  if (j.includes('{')) {
    try { const o = JSON.parse(j.slice(j.indexOf('{'), j.lastIndexOf('}') + 1)); if (o.tool) return { tool: o.tool, args: o.args || {} }; } catch { /* not a tool */ }
  }
  return {};
}

const cleanReply = (s: string) => s.replace(/<\/?longcat[^>]*>/g, '').replace(/\{"tool"[\s\S]*\}/g, '').trim() || 'Done.';

export async function POST(req: NextRequest) {
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'Ozzie chat not configured' }, { status: 503 });
  if (!verifySession(req.cookies.get(PRO_COOKIE)?.value)) return NextResponse.json({ error: 'Osiris Pro required', upgrade: '/ozzie' }, { status: 402 });

  const body = await req.json().catch(() => ({}));
  const incoming: Array<{ role: string; content: string }> = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const convo: Array<{ role: string; content: string }> = [{ role: 'system', content: SYSTEM }, ...incoming];

  const actions: string[] = [];
  let dossier: string | undefined;
  for (let i = 0; i < 6; i++) {
    const out = await llm(convo);
    const t = parseTool(out);
    if (!t.tool) return NextResponse.json({ reply: cleanReply(out), actions, dossier });
    const { obs, dossier: dos } = await exec(t.tool, t.args || {});
    if (dos) dossier = dos;
    actions.push(t.tool);
    convo.push({ role: 'assistant', content: out });
    convo.push({ role: 'user', content: `[tool ${t.tool} result]\n${obs}` });
  }
  const final = await llm([...convo, { role: 'user', content: 'Summarise what you did for me in plain language. No tool calls.' }]);
  return NextResponse.json({ reply: cleanReply(final), actions, dossier });
}
