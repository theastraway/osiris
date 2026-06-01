'use client';

/* Floating "Ask Ozzie" dock — gives the autonomous OSINT analyst a presence on
   every page (incl. the globe). Additive overlay; does not touch the map. */
import { useState } from 'react';

function md(s: string): string {
  const e = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e(s)
    .replace(/^###?\s*(.*)$/gm, '<b style="color:#7fe9ff">$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s*(.*)$/gm, '• $1')
    .replace(/\n/g, '<br/>');
}

export default function OzzieDock() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [dossier, setDossier] = useState('');
  const [needPro, setNeedPro] = useState(false);

  async function run() {
    const t = target.trim(); if (!t || loading) return;
    setLoading(true); setDossier(''); setNeedPro(false);
    try {
      const r = await fetch('/api/ozzie/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: t }) });
      if (r.status === 402) { setNeedPro(true); return; }
      const d = await r.json();
      setDossier(d.dossier || 'No result.');
    } catch { setDossier('Network error — try again.'); } finally { setLoading(false); }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} style={btn} title="Ask Ozzie — autonomous OSINT analyst">
          <span style={{ fontSize: 18 }}>🛰️</span> Ask Ozzie
        </button>
      )}
      {open && (
        <div style={panel}>
          <div style={head}>
            <span><b style={{ color: '#eaf6ff', letterSpacing: 1 }}>🛰️ OZZIE</b> <span style={{ color: '#5f7a8a', fontSize: 11 }}>OSINT analyst · MIND</span></span>
            <button onClick={() => setOpen(false)} style={x}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '10px 12px' }}>
            <input style={input} placeholder="domain / IP / org…" value={target} disabled={loading}
              onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
            <button style={go} onClick={run} disabled={loading}>{loading ? '…' : 'Run'}</button>
          </div>
          <div style={body}>
            {loading && <div style={{ color: '#7fa', fontSize: 12 }}>Ozzie is running the recursive loop (recall → OSINT tools → synthesise). ~60–150s.</div>}
            {needPro && <div style={{ fontSize: 13, color: '#bcd' }}>Investigations are an <b style={{ color: '#00E5FF' }}>Osiris Pro</b> feature.<br /><a href="/ozzie" style={link}>Unlock Pro → $49/mo</a></div>}
            {dossier && <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#cfe' }} dangerouslySetInnerHTML={{ __html: md(dossier) }} />}
            {!loading && !dossier && !needPro && <div style={{ color: '#567', fontSize: 12 }}>Enter a target. Ozzie investigates it across live OSINT sources and returns a cited dossier — saved to its knowledge graph. <a href="/ozzie" style={link}>Full console →</a></div>}
          </div>
        </div>
      )}
    </>
  );
}

const btn: React.CSSProperties = { position: 'fixed', right: 18, bottom: 18, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 999, border: '1px solid #1d6b7d', background: 'linear-gradient(135deg,#00E5FF,#0091b3)', color: '#02121a', fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: '0 6px 24px rgba(0,229,255,0.35)' };
const panel: React.CSSProperties = { position: 'fixed', right: 18, bottom: 18, zIndex: 9999, width: 380, maxWidth: 'calc(100vw - 24px)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: '#08131d', border: '1px solid #16404f', borderRadius: 14, boxShadow: '0 12px 48px rgba(0,0,0,0.6)', fontFamily: 'ui-sans-serif,system-ui,sans-serif' };
const head: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #16303f' };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#7a8', cursor: 'pointer', fontSize: 14 };
const input: React.CSSProperties = { flex: 1, padding: '9px 11px', borderRadius: 8, border: '1px solid #1d3b4d', background: '#0a1622', color: '#eaf6ff', fontSize: 13, outline: 'none' };
const go: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#00E5FF,#0091b3)', color: '#02121a', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const body: React.CSSProperties = { padding: '4px 14px 14px', overflowY: 'auto' };
const link: React.CSSProperties = { color: '#00E5FF', textDecoration: 'none', fontWeight: 600 };
