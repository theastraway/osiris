'use client';

/* ═══════════════════════════════════════════════════════════════
   OZZIE — Admin Portal: Operations + Social
   Operations: see/manage every automation, run them, read the logs,
   manage "alert me when X" monitors. Social: post the intel via Blotato.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import '../ozzie-app.css';

interface Channel { id: string; label: string; platform: string }
interface Run { job: string; at: string; ok: boolean; summary: string }
interface Job { key: string; name: string; cadence: string; cat: string; last: Run | null }
interface Mon { id: string; label: string; type: string; lastAlert?: number }

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};

export default function OzzieAdmin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'ops' | 'social'>('ops');

  const op = (action: string, extra: object = {}) => fetch('/api/ozzie/admin/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
  const soc = (action: string, extra: object = {}) => fetch('/api/ozzie/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });

  // ops state
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runlog, setRunlog] = useState<Run[]>([]);
  const [monitors, setMonitors] = useState<Mon[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [monInput, setMonInput] = useState('');
  const [running, setRunning] = useState('');

  // social state
  const [available, setAvailable] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [source, setSource] = useState('intel');
  const [topic, setTopic] = useState('');
  const [channel, setChannel] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [postlog, setPostlog] = useState<{ at: string; channel: string; ok: boolean; text: string }[]>([]);
  const [auto, setAuto] = useState<{ enabled: boolean; autoChannels: string[] }>({ enabled: false, autoChannels: [] });

  async function loadOps() {
    const r = await op('overview');
    if (r.status === 403) { setAuthed(false); return; }
    setAuthed(true);
    const d = await r.json(); setJobs(d.jobs || []); setRunlog(d.runlog || []); setMonitors(d.monitors || []); setWatchlist(d.watchlist || []);
  }
  async function loadSocial() {
    const d = await (await soc('channels')).json();
    setAvailable(d.available); setChannels(d.channels || []); if (d.channels?.[0]) setChannel(d.channels[0].id);
    soc('log').then((x) => x.json()).then((x) => setPostlog(x.log || []));
    soc('get_config').then((x) => x.json()).then((x) => setAuto({ enabled: !!x.enabled, autoChannels: x.autoChannels || [] }));
  }
  useEffect(() => { loadOps(); loadSocial(); }, []);

  async function runJob(key: string) { setRunning(key); await op('run', { job: key }); await loadOps(); setRunning(''); }
  async function addMon() { const t = monInput.trim(); if (!t) return; const d = await (await op('add_monitor', { text: t })).json(); if (d.monitors) setMonitors(d.monitors); setMonInput(''); }
  async function rmMon(id: string) { const d = await (await op('remove_monitor', { id })).json(); if (d.monitors) setMonitors(d.monitors); }
  async function generate() { setBusy('gen'); setDraft(''); const d = await (await soc('generate', { source, topic, channel })).json(); setDraft(d.draft || ''); setBusy(''); }
  async function postIt() { if (!draft.trim()) return; setBusy('post'); setMsg(''); const r = await (await soc('post', { channelId: channel, text: draft })).json(); setMsg(r.ok ? '✅ Posted.' : `⚠️ ${typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 160)}`); setBusy(''); soc('log').then((x) => x.json()).then((x) => setPostlog(x.log || [])); }
  async function saveAuto(next: typeof auto) { setAuto(next); await soc('set_config', next); }

  if (authed === false) return (
    <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}><div style={{ maxWidth: 540, margin: '80px auto', textAlign: 'center', padding: 20 }}>
      <h1 style={{ color: '#eaf6ff' }}>🛰️ Ozzie Admin</h1><p className="oz-note">Admin access required. Open your admin link with the token.</p>
      <code style={{ color: '#00E5FF', fontSize: 13 }}>/api/ozzie/admin/grant?token=YOUR_ADMIN_TOKEN</code>
    </div></div>
  );
  if (authed === null) return <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}><div style={{ margin: '80px auto', color: '#6f8a9b' }}>Loading…</div></div>;

  const cats = [...new Set(jobs.map((j) => j.cat))];

  return (
    <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}>
      <div className="oz-main">
        <header className="oz-top">
          <div><h1>Ozzie Admin</h1><div className="sub">Operations &amp; social — manage everything Ozzie runs</div></div>
          <a className="oz-navitem" href="/ozzie" style={{ width: 'auto' }}>← console</a>
        </header>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 20px 90px', width: '100%' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button className={`oz-btn`} style={{ opacity: tab === 'ops' ? 1 : 0.5 }} onClick={() => setTab('ops')}>⚙️ Operations</button>
            <button className={`oz-btn`} style={{ opacity: tab === 'social' ? 1 : 0.5 }} onClick={() => setTab('social')}>📣 Social</button>
          </div>

          {tab === 'ops' && <>
            {/* Automations */}
            <div className="oz-watchHead" style={{ marginBottom: 10 }}>🤖 Automations <span style={{ color: '#567', fontWeight: 400 }}>· everything Ozzie runs</span></div>
            {cats.map((cat) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div className="oz-note oz-mono" style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>{cat}</div>
                {jobs.filter((j) => j.cat === cat).map((j) => (
                  <div className="oz-card" key={j.key} style={{ marginBottom: 8, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <b style={{ color: '#eaf6ff' }}>{j.name}</b> <span className="oz-tag oz-mono" style={{ fontSize: 11 }}>{j.cadence}</span>
                        <div className="oz-note" style={{ fontSize: 12, marginTop: 4 }}>
                          {j.last ? <>{j.last.ok ? '✅' : '⚠️'} {ago(j.last.at)} · {j.last.summary}</> : 'not run yet'}
                        </div>
                      </div>
                      <button className="oz-mini" onClick={() => runJob(j.key)} disabled={running === j.key}>{running === j.key ? 'running…' : 'run now'}</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Monitors */}
            <div className="oz-cmd" style={{ marginTop: 18, marginBottom: 18 }}>
              <h2>🔔 Alert rules (Monitors)</h2>
              <p>"Alert me when…" — Ozzie watches live feeds and emails you. Add in plain English.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="oz-input" placeholder="e.g. active fires in the USA" value={monInput} onChange={(e) => setMonInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMon()} />
                <button className="oz-btn" onClick={addMon}>Add</button>
              </div>
              <div style={{ marginTop: 12 }}>
                {monitors.length === 0 ? <div className="oz-note">No monitors yet.</div> : monitors.map((m) => (
                  <div className="oz-row" key={m.id}>
                    <span><span className="oz-tag oz-mono">{m.type}</span> {m.label} {m.lastAlert ? <span className="oz-note" style={{ fontSize: 11 }}>· last fired {ago(new Date(m.lastAlert).toISOString())}</span> : <span className="oz-note" style={{ fontSize: 11 }}>· never fired</span>}</span>
                    <button className="oz-mini danger" onClick={() => rmMon(m.id)}>remove</button>
                  </div>
                ))}
              </div>
              {watchlist.length > 0 && <div className="oz-note" style={{ marginTop: 12 }}>Watchlist: {watchlist.join(', ')}</div>}
            </div>

            {/* Run log */}
            <div className="oz-card">
              <div className="oz-watchHead">🧾 Run log</div>
              {runlog.length === 0 ? <div className="oz-note">No runs logged yet.</div> : runlog.map((r, i) => (
                <div className="oz-row" key={i} style={{ fontSize: 13 }}>
                  <span>{r.ok ? '✅' : '⚠️'} <span className="oz-mono" style={{ color: '#9bd' }}>{r.job}</span> — {r.summary}</span>
                  <span className="oz-note" style={{ fontSize: 11 }}>{ago(r.at)}</span>
                </div>
              ))}
            </div>
          </>}

          {tab === 'social' && <>
            <div className="oz-card" style={{ marginBottom: 18 }}>
              <div className="oz-watchHead">🔗 Blotato connection</div>
              <div className="oz-note" style={{ marginTop: 6 }}>{available ? `Connected · ${channels.length} channels` : 'BLOTATO_API_KEY not set'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>{channels.map((c) => <span key={c.id} className="oz-tag oz-mono">{c.label}</span>)}</div>
            </div>
            <div className="oz-cmd" style={{ marginBottom: 18 }}>
              <h2>Compose a post</h2><p>Ozzie drafts from the live intelligence graph (owl), tailored to the channel.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <select value={source} onChange={(e) => setSource(e.target.value)} style={sel}><option value="intel">Top intelligence</option><option value="dossier">Top dossier</option><option value="custom">Custom topic</option></select>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} style={sel}>{channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                <button className="oz-btn" onClick={generate} disabled={busy === 'gen'}>{busy === 'gen' ? 'Drafting…' : 'Generate'}</button>
              </div>
              {source === 'custom' && <input className="oz-input" placeholder="topic" value={topic} onChange={(e) => setTopic(e.target.value)} style={{ marginBottom: 10 }} />}
              <textarea className="oz-input" style={{ width: '100%', minHeight: 130, resize: 'vertical' }} placeholder="The generated post appears here — edit before posting." value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}><span className="oz-note">{draft.length} chars</span><button className="oz-btn" onClick={postIt} disabled={busy === 'post' || !draft.trim()}>{busy === 'post' ? 'Posting…' : 'Post now →'}</button></div>
              {msg && <div className="oz-note" style={{ marginTop: 8, color: msg.startsWith('✅') ? '#7fa' : '#f88' }}>{msg}</div>}
            </div>
            <div className="oz-card" style={{ marginBottom: 18 }}>
              <div className="oz-watchHead">⚙️ Auto-post workflow <span style={{ color: '#567', fontWeight: 400 }}>· daily, the top finding</span></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', color: '#cfe', fontSize: 14 }}><input type="checkbox" checked={auto.enabled} onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} /> Enable daily auto-posting</label>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>{channels.map((c) => <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9bd', fontSize: 13 }}><input type="checkbox" checked={auto.autoChannels.includes(c.id)} onChange={(e) => saveAuto({ ...auto, autoChannels: e.target.checked ? [...auto.autoChannels, c.id] : auto.autoChannels.filter((x) => x !== c.id) })} /> {c.label}</label>)}</div>
            </div>
            <div className="oz-card">
              <div className="oz-watchHead">🧾 Recent posts</div>
              {postlog.length === 0 ? <div className="oz-note">No posts yet.</div> : postlog.map((l, i) => <div key={i} className="oz-row" style={{ fontSize: 13 }}><span>{l.ok ? '✅' : '⚠️'} <span className="oz-mono" style={{ color: '#9bd' }}>{l.channel}</span> — {l.text}</span><span className="oz-note" style={{ fontSize: 11 }}>{ago(l.at)}</span></div>)}
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
const sel: React.CSSProperties = { padding: '12px 14px', borderRadius: 10, border: '1px solid #1d3b4d', background: '#0a1622', color: '#eaf6ff', fontSize: 14 };
