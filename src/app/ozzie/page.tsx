'use client';

/* ═══════════════════════════════════════════════════════════════
   OZZIE — Intelligence Console
   A dark command-center app for the Osiris OSINT analyst: investigate,
   monitor live feeds, manage watchlists, review dossiers. Free tier tastes
   it (summary-only); Pro unlocks full dossiers + 24/7 monitoring.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Bell, Bookmark, FileText, Info, Lock, Trash2, Radar, Globe, Sparkles, Send } from 'lucide-react';
import './ozzie-app.css';

type View = 'chat' | 'investigate' | 'monitors' | 'watchlist' | 'dossiers' | 'about';
interface ChatMsg { role: 'user' | 'assistant'; content: string; dossier?: string; actions?: string[] }
interface TraceStep { step: number; tool?: string; input?: string }
interface Result { target: string; dossier: string; steps?: number; trace?: TraceStep[]; locked?: boolean; locked_findings?: number; locked_risk_flags?: number; remaining?: number; persisted_to_mind?: boolean }
interface Monitor { id: string; label: string; type: string }

const EXAMPLES = ['openai.com', '1.1.1.1', 'tesla.com', 'anthropic.com'];
const PRESETS = ['active fires in the USA', 'earthquakes over magnitude 6', 'new sanctions on a shipping company'];

function md(s: string): string {
  const e = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e(s)
    .replace(/^###?\s*(.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*•]\s*(.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
}

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.25 } };

export default function OzzieConsole() {
  const [view, setView] = useState<View>('chat');
  const [pro, setPro] = useState<boolean | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const [chat, setChat] = useState<ChatMsg[]>([{ role: 'assistant', content: "I'm Ozzie. Tell me what you want and I'll run it — \"investigate openai.com\", \"watch for active fires in the USA\", \"add tesla.com to my watchlist\", or \"send my alerts to me@email.com\"." }]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, chatBusy]);

  async function sendChat(text?: string) {
    const msg = (text ?? chatInput).trim(); if (!msg || chatBusy) return;
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }];
    setChat(next); setChatInput(''); setChatBusy(true);
    try {
      const r = await fetch('/api/ozzie/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }) });
      if (r.status === 402) { setChat([...next, { role: 'assistant', content: 'Ozzie Chat is a Pro feature — it can operate investigations, monitors, and your watchlist for you. Upgrade to unlock it.' }]); return; }
      const d = await r.json();
      setChat([...next, { role: 'assistant', content: d.reply || 'Done.', dossier: d.dossier, actions: d.actions }]);
      if (d.actions?.includes('add_monitor')) fetch('/api/ozzie/monitors').then((x) => x.json()).then((m) => setMonitors(m.monitors || [])).catch(() => {});
      if (d.actions?.includes('add_watchlist') || d.actions?.includes('remove_watchlist')) fetch('/api/ozzie/watchlist').then((x) => x.json()).then((w) => setWatchlist(w.watchlist || [])).catch(() => {});
    } catch { setChat([...next, { role: 'assistant', content: 'Network hiccup — try again.' }]); }
    finally { setChatBusy(false); }
  }

  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Result[]>([]);
  const phaseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monInput, setMonInput] = useState('');
  const [monBusy, setMonBusy] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchInput, setWatchInput] = useState('');

  useEffect(() => {
    fetch('/api/billing/comp?status=1').then((r) => r.json()).then((d) => {
      setPro(Boolean(d.pro));
      if (d.pro) {
        fetch('/api/ozzie/monitors').then((r) => r.json()).then((m) => setMonitors(m.monitors || [])).catch(() => {});
        fetch('/api/ozzie/watchlist').then((r) => r.json()).then((w) => setWatchlist(w.watchlist || [])).catch(() => {});
      }
    }).catch(() => setPro(false));
  }, []);

  async function upgrade() {
    if (upgrading) return; setUpgrading(true);
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json(); if (d.url) window.location.href = d.url;
    } finally { setUpgrading(false); }
  }

  async function investigate(t0?: string) {
    const t = (t0 ?? target).trim(); if (!t || loading) return;
    setTarget(t); setLoading(true); setError(''); setResult(null); setPhase(0);
    phaseTimer.current = setInterval(() => setPhase((p) => (p < 2 ? p + 1 : p)), 22000);
    try {
      const r = await fetch('/api/ozzie/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: t }) });
      if (r.status === 402) { const d = await r.json(); setError(d.message || 'Daily free limit reached — go Pro for unlimited.'); return; }
      if (!r.ok) { setError(r.status === 503 ? 'Ozzie is not configured.' : `Error ${r.status} — try again.`); return; }
      const d: Result = await r.json();
      setResult(d); setHistory((h) => [{ ...d }, ...h].slice(0, 12));
    } catch { setError('Network error — try again.'); }
    finally { setLoading(false); if (phaseTimer.current) clearInterval(phaseTimer.current); }
  }

  async function addMonitor() {
    const t = monInput.trim(); if (!t || monBusy) return; setMonBusy(true); setError('');
    try {
      const r = await fetch('/api/ozzie/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_nl', text: t }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || 'Could not add monitor.'); return; }
      setMonitors(d.monitors || []); setMonInput('');
    } finally { setMonBusy(false); }
  }
  const removeMonitor = async (id: string) => { const r = await fetch('/api/ozzie/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id }) }); const d = await r.json(); if (d.monitors) setMonitors(d.monitors); };
  async function addWatch(t0?: string) { const t = (t0 ?? watchInput).trim().toLowerCase(); if (!t) return; const r = await fetch('/api/ozzie/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', target: t }) }); const d = await r.json(); if (d.watchlist) setWatchlist(d.watchlist); setWatchInput(''); }
  const removeWatch = async (t: string) => { const r = await fetch('/api/ozzie/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', target: t }) }); const d = await r.json(); if (d.watchlist) setWatchlist(d.watchlist); };

  const NAV: { id: View; label: string; icon: React.ReactNode; pro?: boolean }[] = [
    { id: 'chat', label: 'Ozzie', icon: <Sparkles size={17} /> },
    { id: 'investigate', label: 'Investigate', icon: <Search size={17} /> },
    { id: 'monitors', label: 'Monitors', icon: <Bell size={17} />, pro: true },
    { id: 'watchlist', label: 'Watchlist', icon: <Bookmark size={17} />, pro: true },
    { id: 'dossiers', label: 'Dossiers', icon: <FileText size={17} /> },
    { id: 'about', label: 'About Ozzie', icon: <Info size={17} /> },
  ];
  const titles: Record<View, [string, string]> = {
    chat: ['Ozzie', 'Chat with Ozzie — it operates everything for you'],
    investigate: ['Investigate', 'Point Ozzie at a target — get a cited intelligence dossier'],
    monitors: ['Monitors', 'Ozzie watches live feeds 24/7 and alerts you'],
    watchlist: ['Watchlist', 'Entities Ozzie re-investigates and briefs you on daily'],
    dossiers: ['Dossiers', 'Your recent investigations'],
    about: ['About Ozzie', 'Autonomous open-source-intelligence analyst'],
  };

  const ProLockView = ({ title, body }: { title: string; body: string }) => (
    <div className="oz-locked-view">
      <Lock size={26} color="#00E5FF" />
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="oz-btn" onClick={upgrade} disabled={upgrading}>{upgrading ? 'Starting checkout…' : 'Unlock with Pro — $49/mo →'}</button>
    </div>
  );

  return (
    <div className="oz-app">
      {/* ── Sidebar ── */}
      <aside className="oz-side">
        <a className="oz-brand" href="/"><img src="/ozzie-logo.jpg" alt="" /><span><b>OZZIE</b><span>OSINT · MIND</span></span></a>
        <nav className="oz-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`oz-navitem${view === n.id ? ' active' : ''}${n.pro && !pro ? ' locked' : ''}`} onClick={() => setView(n.id)}>
              {n.icon} {n.label} {n.pro && !pro && <Lock size={12} className="lk" />}
            </button>
          ))}
        </nav>
        <div className="oz-side-foot">
          <div className="oz-tier"><span>Plan</span><span className={`oz-pill ${pro ? 'pro' : 'free'}`}>{pro === null ? '…' : pro ? 'PRO' : 'FREE'}</span></div>
          {pro === false && <button className="oz-side-cta" onClick={upgrade} disabled={upgrading}>{upgrading ? '…' : 'Upgrade to Pro'}</button>}
          <a className="oz-navitem" href="/" style={{ marginTop: 8 }}><Globe size={16} /> Back to globe</a>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="oz-main">
        <header className="oz-top">
          <div><h1>{titles[view][0]}</h1><div className="sub">{titles[view][1]}</div></div>
          <div className="oz-live"><span className="oz-dot" /> live · powered by MIND</div>
        </header>

        <AnimatePresence mode="wait">
          {/* CHAT — Ozzie operates itself */}
          {view === 'chat' && (
            <motion.div key="chat" className="oz-work solo" {...fade}>
              {pro ? (
                <div className="oz-chat">
                  <div className="oz-chatlog">
                    {chat.map((m, i) => (
                      <div key={i} className={`oz-msg ${m.role}`}>
                        {m.role === 'assistant' && <img className="oz-msg-av" src="/ozzie-logo.jpg" alt="" />}
                        <div className="oz-bubble">
                          <div dangerouslySetInnerHTML={{ __html: md(m.content) }} />
                          {m.actions && m.actions.length > 0 && <div className="oz-actions">{m.actions.map((a, j) => <span key={j} className="oz-tag oz-mono">{a}</span>)}</div>}
                          {m.dossier && <div className="oz-dossier" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: md(m.dossier) }} />}
                        </div>
                      </div>
                    ))}
                    {chatBusy && <div className="oz-msg assistant"><img className="oz-msg-av" src="/ozzie-logo.jpg" alt="" /><div className="oz-bubble"><span className="oz-typing"><i /><i /><i /></span> <span className="oz-note">Ozzie is working… (investigations take ~60–150s)</span></div></div>}
                    <div ref={chatEnd} />
                  </div>
                  <div className="oz-chips" style={{ padding: '0 4px 10px' }}>
                    {['investigate openai.com', 'watch for active fires in the USA', 'add tesla.com to my watchlist', 'send my alerts to me@email.com'].map((q) => <button key={q} className="oz-chip" onClick={() => sendChat(q)} disabled={chatBusy}>{q}</button>)}
                  </div>
                  <div className="oz-chatbar">
                    <input className="oz-input" placeholder="Ask Ozzie to do something…" value={chatInput} disabled={chatBusy}
                      onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} />
                    <button className="oz-btn" onClick={() => sendChat()} disabled={chatBusy}><Send size={16} /></button>
                  </div>
                </div>
              ) : <ProLockView title="Ozzie Chat is Pro" body="Talk to Ozzie in plain English and it runs everything for you — investigations, monitors, watchlists, and alert settings. Your own analyst on call, 24/7." />}
            </motion.div>
          )}

          {/* INVESTIGATE */}
          {view === 'investigate' && (
            <motion.div key="inv" className={`oz-work${pro ? '' : ''}`} {...fade}>
              <div className="oz-col">
                <div className="oz-cmd">
                  <h2>What should Ozzie investigate?</h2>
                  <p>A domain, IP, company, person, or crypto wallet. Ozzie searches 20+ open sources, follows the leads, and writes a cited dossier.</p>
                  <div className="oz-inputrow">
                    <input className="oz-input" placeholder="e.g. openai.com" value={target} disabled={loading}
                      onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && investigate()} />
                    <button className="oz-btn" onClick={() => investigate()} disabled={loading || pro === null}>{loading ? 'Investigating…' : 'Investigate'}</button>
                  </div>
                  <div className="oz-chips">{EXAMPLES.map((x) => <button key={x} className="oz-chip" onClick={() => investigate(x)} disabled={loading}>{x}</button>)}</div>

                  {loading && (
                    <>
                      <div className="oz-steps">
                        {['RECALL', 'COLLECT', 'SYNTHESIZE'].map((s, i) => (
                          <div key={s} className={`oz-step${phase >= i ? ' on' : ''}`}><div className="n oz-mono">0{i + 1}</div><div className="t">{s}</div></div>
                        ))}
                      </div>
                      <div className="oz-note" style={{ marginTop: 12 }}>Ozzie is running the recursive enrichment loop — this takes ~60–150s.</div>
                    </>
                  )}
                  {error && <div className="oz-err">{error}{!pro && <> · <a style={{ color: '#00E5FF', cursor: 'pointer' }} onClick={upgrade}>Go Pro →</a></>}</div>}
                </div>

                {result && (
                  <motion.div {...fade}>
                    <div className="oz-dossier">
                      <div className="oz-meta">
                        <span>Target: <b style={{ color: '#00E5FF' }} className="oz-mono">{result.target}</b></span>
                        {result.steps ? <span>{result.steps} tool steps</span> : null}
                        {result.persisted_to_mind && <span>✓ saved to knowledge graph</span>}
                      </div>
                      <div dangerouslySetInnerHTML={{ __html: md(result.dossier) }} />
                      {result.locked && (
                        <div className="oz-lock">
                          <div className="t">🔒 {(result.locked_findings || 0) + (result.locked_risk_flags || 0)} findings &amp; {result.locked_risk_flags || 0} risk flags hidden</div>
                          <div className="s">Ozzie already found them. The full dossier — findings, risk flags, sources — is Pro. {result.remaining ?? 0} free summaries left today.</div>
                          <button className="oz-btn" style={{ marginTop: 12 }} onClick={upgrade} disabled={upgrading}>{upgrading ? '…' : 'Unlock the full dossier — Pro $49/mo →'}</button>
                        </div>
                      )}
                      {result.trace && result.trace.length > 0 && (
                        <div className="oz-trace">
                          {result.trace.filter((t) => t.tool).map((t) => (
                            <div key={t.step} className="oz-trow"><span className="oz-tag oz-mono">{t.tool}</span><span className="oz-mono" style={{ color: '#7a8' }}>{t.input}</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Rail */}
              <div className="oz-rail">
                <div className="oz-panel">
                  <h3>How Ozzie works</h3>
                  {[['1', 'Recall', 'Checks its knowledge graph for what it already knows'], ['2', 'Collect', 'Runs WHOIS, DNS, certs, IP, sanctions, CVE lookups'], ['3', 'Synthesize', 'Writes a cited dossier and remembers it']].map(([n, t, d]) => (
                    <div className="oz-how" key={n}><div className="ix oz-mono">{n}</div><div className="bd"><b>{t}</b><span>{d}</span></div></div>
                  ))}
                </div>
                <div className="oz-panel">
                  <h3>This session</h3>
                  <div className="oz-stats">
                    <div className="oz-stat"><div className="v">{history.length}</div><div className="k">investigations</div></div>
                    <div className="oz-stat"><div className="v">{monitors.length}</div><div className="k">monitors</div></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* MONITORS */}
          {view === 'monitors' && (
            <motion.div key="mon" className="oz-work solo" {...fade}>
              {pro ? (
                <div className="oz-col">
                  <div className="oz-cmd">
                    <h2>Tell Ozzie what to watch</h2>
                    <p>Plain English. Ozzie checks the live feeds every ~20 minutes and emails you the moment it trips.</p>
                    <div className="oz-inputrow">
                      <input className="oz-input" placeholder="e.g. active fires in the USA" value={monInput} disabled={monBusy}
                        onChange={(e) => setMonInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMonitor()} />
                      <button className="oz-btn" onClick={addMonitor} disabled={monBusy}>{monBusy ? '…' : 'Watch'}</button>
                    </div>
                    <div className="oz-presets">{PRESETS.map((p) => <button key={p} className="oz-chip" onClick={() => { setMonInput(p); }}>{p}</button>)}</div>
                    {error && <div className="oz-err">{error}</div>}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    {monitors.length === 0 ? <div className="oz-note">No monitors yet. Add one above.</div> :
                      monitors.map((m) => (
                        <div className="oz-card" key={m.id} style={{ marginBottom: 10 }}>
                          <div className="oz-row" style={{ borderTop: 'none', padding: 0 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Radar size={16} color="#00E5FF" /> <b>{m.label}</b> <span className="oz-tag oz-mono">{m.type}</span></span>
                            <button className="oz-mini danger" onClick={() => removeMonitor(m.id)}><Trash2 size={13} /></button>
                          </div>
                          <div className="oz-note" style={{ marginTop: 6, fontSize: 12 }}>Checked every ~20 min · alerts emailed + logged to the graph</div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : <ProLockView title="24/7 Monitoring is Pro" body={`The world doesn't stop when you close the tab. Pro lets Ozzie watch live feeds around the clock — "alert me on active fires in the USA," "earthquakes over M6" — and email you the instant it happens. On Free, you're flying blind between checks.`} />}
            </motion.div>
          )}

          {/* WATCHLIST */}
          {view === 'watchlist' && (
            <motion.div key="wl" className="oz-work solo" {...fade}>
              {pro ? (
                <div className="oz-col">
                  <div className="oz-cmd">
                    <h2>Watchlist</h2>
                    <p>Targets Ozzie re-investigates automatically and folds into your daily intelligence brief.</p>
                    <div className="oz-inputrow">
                      <input className="oz-input" placeholder="add a target to monitor…" value={watchInput}
                        onChange={(e) => setWatchInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWatch()} />
                      <button className="oz-btn" onClick={() => addWatch()}>Add</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    {watchlist.length === 0 ? <div className="oz-note">No targets yet.</div> :
                      watchlist.map((w) => (
                        <div className="oz-row" key={w}>
                          <span className="oz-mono" style={{ color: '#cfe' }}>{w}</span>
                          <span>
                            <button className="oz-mini" onClick={() => { setView('investigate'); investigate(w); }}>investigate</button>
                            <button className="oz-mini danger" style={{ marginLeft: 6 }} onClick={() => removeWatch(w)}>remove</button>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : <ProLockView title="Watchlists are Pro" body="Save the targets that matter and Ozzie keeps them current — re-investigating each one and surfacing changes in a daily brief, so you don't have to remember to look." />}
            </motion.div>
          )}

          {/* DOSSIERS */}
          {view === 'dossiers' && (
            <motion.div key="dos" className="oz-work solo" {...fade}>
              <div className="oz-col">
                {history.length === 0 ? <div className="oz-locked-view"><FileText size={26} color="#00E5FF" /><h2>No dossiers yet</h2><p>Run an investigation and it'll appear here — and persist in Ozzie's knowledge graph.</p><button className="oz-btn" onClick={() => setView('investigate')}>Start investigating →</button></div> :
                  history.map((h, i) => (
                    <div className="oz-card" key={i} style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => { setResult(h); setView('investigate'); }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b className="oz-mono" style={{ color: '#00E5FF' }}>{h.target}</b>{h.locked && <Lock size={13} color="#6f8a9b" />}</div>
                      <div className="oz-note" style={{ marginTop: 6 }}>{(h.dossier || '').replace(/[#*]/g, '').slice(0, 150)}…</div>
                    </div>
                  ))}
              </div>
            </motion.div>
          )}

          {/* ABOUT */}
          {view === 'about' && (
            <motion.div key="abt" className="oz-work solo" {...fade}>
              <div className="oz-col">
                <div className="oz-about-hero">
                  <img src="/ozzie-logo.jpg" alt="" style={{ width: 60, height: 60, borderRadius: 14 }} />
                  <h2>Ozzie investigates anything.</h2>
                  <p>Give Ozzie a domain, IP, company, person, or wallet. It searches 20+ live open-source-intelligence feeds, reasons through the leads, and hands you a fully cited dossier — then remembers it, so it gets sharper over time.</p>
                </div>
                <div className="oz-feat">
                  {[[<Search size={18} key="a" />, 'Investigate', 'Domains · IPs · orgs · people · wallets'], [<Radar size={18} key="b" />, 'Recursive AI', 'Follows leads and cites every fact'], [<Bell size={18} key="c" />, '24/7 Monitors', 'Watchlists + alerts to your inbox'], [<FileText size={18} key="d" />, 'Knowledge Graph', 'Every finding remembered, compounding']].map(([ic, t, d], i) => (
                    <div className="oz-card" key={i}><div style={{ color: '#00E5FF', marginBottom: 8 }}>{ic}</div><b>{t}</b><div className="oz-note" style={{ marginTop: 4 }}>{d}</div></div>
                  ))}
                </div>
                <div className="oz-cmd" style={{ textAlign: 'center' }}>
                  <h2>{pro ? "You're on Pro — investigate away." : 'Osiris Pro — $49/mo'}</h2>
                  <p>{pro ? 'Unlimited dossiers, watchlists, and 24/7 monitoring are all yours.' : 'Unlimited full dossiers, the compounding knowledge graph, and 24/7 monitoring with instant alerts.'}</p>
                  {!pro && <button className="oz-btn" onClick={upgrade} disabled={upgrading}>{upgrading ? 'Starting checkout…' : 'Upgrade to Pro →'}</button>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile tab bar ── */}
      <nav className="oz-mtabs">
        {NAV.filter((n) => n.id !== 'about').map((n) => (
          <button key={n.id} className={`oz-mtab${view === n.id ? ' active' : ''}`} onClick={() => setView(n.id)}>{n.icon}<span>{n.label}</span></button>
        ))}
      </nav>
    </div>
  );
}
