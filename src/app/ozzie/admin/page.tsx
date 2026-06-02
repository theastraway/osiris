'use client';

/* ═══════════════════════════════════════════════════════════════
   OZZIE — Admin Portal
   Connect Blotato + run social workflows: turn the intelligence graph
   into posts (generate via owl → publish via Blotato), manual or auto.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import '../ozzie-app.css';

interface Channel { id: string; label: string; platform: string }
interface LogRow { at: string; channel: string; ok: boolean; text: string }

export default function OzzieAdmin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [source, setSource] = useState<'intel' | 'dossier' | 'custom'>('intel');
  const [topic, setTopic] = useState('');
  const [channel, setChannel] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState<LogRow[]>([]);
  const [auto, setAuto] = useState<{ enabled: boolean; autoChannels: string[] }>({ enabled: false, autoChannels: [] });

  const call = (action: string, extra: object = {}) =>
    fetch('/api/ozzie/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });

  async function load() {
    const r = await call('channels');
    if (r.status === 403) { setAuthed(false); return; }
    setAuthed(true);
    const d = await r.json(); setAvailable(d.available); setChannels(d.channels || []); if (d.channels?.[0]) setChannel(d.channels[0].id);
    call('log').then((x) => x.json()).then((x) => setLog(x.log || [])).catch(() => {});
    call('get_config').then((x) => x.json()).then((x) => setAuto({ enabled: !!x.enabled, autoChannels: x.autoChannels || [] })).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function generate() {
    setBusy('gen'); setMsg(''); setDraft('');
    const d = await (await call('generate', { source, topic, channel })).json();
    setDraft(d.draft || ''); setBusy('');
  }
  async function postIt() {
    if (!draft.trim()) return; setBusy('post'); setMsg('');
    const r = await (await call('post', { channelId: channel, text: draft })).json();
    setMsg(r.ok ? '✅ Posted.' : `⚠️ ${typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 200)} (${r.status || ''})`);
    setBusy(''); call('log').then((x) => x.json()).then((x) => setLog(x.log || []));
  }
  async function saveAuto(next: typeof auto) { setAuto(next); await call('set_config', next); }

  if (authed === false) return (
    <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}>
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: 20 }}>
        <h1 style={{ color: '#eaf6ff' }}>🛰️ Ozzie Admin</h1>
        <p className="oz-note">Admin access required. Open your admin link:</p>
        <code style={{ color: '#00E5FF', fontSize: 13 }}>/api/ozzie/admin/grant?token=YOUR_ADMIN_TOKEN</code>
      </div>
    </div>
  );
  if (authed === null) return <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}><div style={{ margin: '80px auto', color: '#6f8a9b' }}>Loading…</div></div>;

  return (
    <div className="oz-app" style={{ gridTemplateColumns: '1fr' }}>
      <div className="oz-main">
        <header className="oz-top"><div><h1>Ozzie Admin · Social</h1><div className="sub">Turn the intelligence graph into posts — Blotato</div></div><a className="oz-navitem" href="/ozzie" style={{ width: 'auto' }}>← console</a></header>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 80px', width: '100%' }}>

          {/* Connection */}
          <div className="oz-card" style={{ marginBottom: 18 }}>
            <div className="oz-watchHead">🔗 Blotato connection</div>
            <div className="oz-note" style={{ marginTop: 6 }}>{available ? `Connected · ${channels.length} channels` : 'BLOTATO_API_KEY not set'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {channels.map((c) => <span key={c.id} className="oz-tag oz-mono">{c.label}</span>)}
            </div>
          </div>

          {/* Generate + Post */}
          <div className="oz-cmd" style={{ marginBottom: 18 }}>
            <h2>Compose a post</h2>
            <p>Ozzie drafts from the live intelligence graph (owl), tailored to the channel.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <select value={source} onChange={(e) => setSource(e.target.value as 'intel')} style={sel}>
                <option value="intel">Top intelligence</option>
                <option value="dossier">Top entity dossier</option>
                <option value="custom">Custom topic</option>
              </select>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} style={sel}>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button className="oz-btn" onClick={generate} disabled={busy === 'gen'}>{busy === 'gen' ? 'Drafting…' : 'Generate'}</button>
            </div>
            {source === 'custom' && <input className="oz-input" placeholder="topic, e.g. supply-chain attacks this week" value={topic} onChange={(e) => setTopic(e.target.value)} style={{ marginBottom: 10 }} />}
            <textarea className="oz-input" style={{ width: '100%', minHeight: 130, resize: 'vertical' }} placeholder="The generated post appears here — edit before posting." value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span className="oz-note">{draft.length} chars</span>
              <button className="oz-btn" onClick={postIt} disabled={busy === 'post' || !draft.trim()}>{busy === 'post' ? 'Posting…' : 'Post now →'}</button>
            </div>
            {msg && <div className="oz-note" style={{ marginTop: 8, color: msg.startsWith('✅') ? '#7fa' : '#f88' }}>{msg}</div>}
          </div>

          {/* Auto-post workflow */}
          <div className="oz-card" style={{ marginBottom: 18 }}>
            <div className="oz-watchHead">⚙️ Auto-post workflow <span style={{ color: '#567', fontWeight: 400 }}>· Ozzie posts the day's top finding</span></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', color: '#cfe', fontSize: 14 }}>
              <input type="checkbox" checked={auto.enabled} onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} /> Enable daily auto-posting
            </label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {channels.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9bd', fontSize: 13 }}>
                  <input type="checkbox" checked={auto.autoChannels.includes(c.id)} onChange={(e) => saveAuto({ ...auto, autoChannels: e.target.checked ? [...auto.autoChannels, c.id] : auto.autoChannels.filter((x) => x !== c.id) })} /> {c.label}
                </label>
              ))}
            </div>
          </div>

          {/* Log */}
          <div className="oz-card">
            <div className="oz-watchHead">🧾 Recent posts</div>
            {log.length === 0 ? <div className="oz-note">No posts yet.</div> : log.map((l, i) => (
              <div key={i} className="oz-row"><span style={{ fontSize: 13 }}>{l.ok ? '✅' : '⚠️'} <span className="oz-mono" style={{ color: '#9bd' }}>{l.channel}</span> — {l.text}</span><span className="oz-note" style={{ fontSize: 11 }}>{l.at?.slice(5, 16).replace('T', ' ')}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const sel: React.CSSProperties = { padding: '12px 14px', borderRadius: 10, border: '1px solid #1d3b4d', background: '#0a1622', color: '#eaf6ff', fontSize: 14 };
