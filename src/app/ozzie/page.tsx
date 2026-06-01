'use client';

/* ═══════════════════════════════════════════════════════════════
   OZZIE — Investigation Console
   Standalone surface (osiris.theastraway.com/ozzie). Submit a target,
   Ozzie runs the recursive OSINT enrichment loop and returns a cited
   dossier + the tool trace. Persists to the @ozzie knowledge graph.
   ═══════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';

interface TraceStep { step: number; tool?: string; input?: string; thought?: string; }
interface OzzieResult { target: string; dossier: string; steps: number; persisted_to_mind: boolean; trace?: TraceStep[]; locked?: boolean; locked_findings?: number; locked_risk_flags?: number; remaining?: number; }

function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(md)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

export default function OzziePage() {
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OzzieResult | null>(null);
  const [error, setError] = useState('');
  const [pro, setPro] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchInput, setWatchInput] = useState('');
  const [monitors, setMonitors] = useState<Array<{ id: string; label: string; type: string }>>([]);
  const [monInput, setMonInput] = useState('');
  const [monBusy, setMonBusy] = useState(false);
  const [monErr, setMonErr] = useState('');

  useEffect(() => {
    fetch('/api/billing/comp?status=1').then((r) => r.json()).then((d) => {
      setPro(Boolean(d.pro));
      if (d.pro) {
        fetch('/api/ozzie/watchlist').then((r) => r.json()).then((w) => setWatchlist(w.watchlist || [])).catch(() => {});
        fetch('/api/ozzie/monitors').then((r) => r.json()).then((m) => setMonitors(m.monitors || [])).catch(() => {});
      }
    }).catch(() => setPro(false));
  }, []);

  async function addMonitor() {
    const t = monInput.trim(); if (!t || monBusy) return;
    setMonBusy(true); setMonErr('');
    try {
      const r = await fetch('/api/ozzie/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_nl', text: t }) });
      const d = await r.json();
      if (!r.ok) { setMonErr(d.error || 'Could not add monitor.'); return; }
      setMonitors(d.monitors || []); setMonInput('');
    } catch { setMonErr('Network error.'); } finally { setMonBusy(false); }
  }
  async function removeMonitor(mid: string) {
    const r = await fetch('/api/ozzie/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: mid }) });
    const d = await r.json(); if (d.monitors) setMonitors(d.monitors);
  }

  async function watch(action: 'add' | 'remove', t: string) {
    const r = await fetch('/api/ozzie/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, target: t }) });
    const d = await r.json(); if (d.watchlist) setWatchlist(d.watchlist); setWatchInput('');
  }

  async function upgrade() {
    if (upgrading) return; setUpgrading(true); setError('');
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const d = await r.json();
      if (d.url) window.location.href = d.url; else setError('Checkout unavailable — try again.');
    } catch { setError('Checkout error — try again.'); } finally { setUpgrading(false); }
  }

  async function investigate() {
    const t = target.trim();
    if (!t || loading) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/ozzie/investigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      });
      if (r.status === 402) { const d = await r.json(); setError(d.message || 'Free limit reached. Upgrade for unlimited.'); return; }
      if (!r.ok) { setError(`Ozzie error (${r.status}). ${r.status === 503 ? 'Not configured.' : 'Try again.'}`); return; }
      setResult(await r.json());
    } catch { setError('Network error — try again.'); }
    finally { setLoading(false); }
  }

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <header style={S.header}>
          <div style={S.logo}>🛰️ OZZIE</div>
          <div style={S.tag}>Autonomous OSINT analyst · powered by MIND</div>
        </header>

        {pro === false && (
          <div style={S.freeBanner}>
            <span><b style={{ color: '#cfe' }}>Free tier</b> · 2 investigations/day · summary only.</span>
            <button style={S.bannerUpgrade} onClick={upgrade} disabled={upgrading}>{upgrading ? '…' : 'Go Pro — full dossiers + 24/7 alerts →'}</button>
          </div>
        )}
        <div style={S.bar}>
          <input
            style={S.input}
            placeholder="Enter a target — domain, IP, org, or person (e.g. openai.com)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && investigate()}
            disabled={loading || pro === null}
          />
          <button style={{ ...S.btn, opacity: loading || pro === null ? 0.6 : 1 }} onClick={investigate} disabled={loading || pro === null}>
            {loading ? 'Investigating…' : 'Investigate'}
          </button>
        </div>

        {loading && <div style={S.note}>Ozzie is running the recursive enrichment loop — recall → OSINT tools → synthesise. This takes ~30–90s.</div>}
        {error && <div style={{ ...S.note, color: '#FF6B6B' }}>{error}</div>}

        {result && (
          <div style={S.results}>
            <div style={S.meta}>
              <span>Target: <b style={{ color: '#00E5FF' }}>{result.target}</b></span>
              <span>{result.steps} tool steps</span>
              <span>{result.persisted_to_mind ? '✓ saved to knowledge graph' : ''}</span>
            </div>
            <div style={S.dossier} dangerouslySetInnerHTML={{ __html: renderMarkdown(result.dossier) }} />

            {result.locked && (
              <div style={S.lock}>
                <div style={S.lockTitle}>🔒 {(result.locked_findings || 0) + (result.locked_risk_flags || 0)} findings &amp; {result.locked_risk_flags || 0} risk flags are hidden</div>
                <div style={S.lockSub}>Ozzie already found them — the full dossier (findings, risk flags, sources) is Pro-only. You have {result.remaining ?? 0} free summary left today.</div>
                <button style={{ ...S.btn, marginTop: 12, opacity: upgrading ? 0.6 : 1 }} onClick={upgrade} disabled={upgrading}>{upgrading ? 'Starting checkout…' : 'Unlock the full dossier — Pro $49/mo →'}</button>
              </div>
            )}

            {result.trace && (
              <details style={S.trace}>
                <summary style={S.summary}>Investigation trace ({result.trace.filter((t) => t.tool).length} tool calls)</summary>
                {result.trace.filter((t) => t.tool).map((t) => (
                  <div key={t.step} style={S.traceRow}>
                    <span style={S.toolTag}>{t.tool}</span>
                    <span style={{ color: '#7a8' }}>{t.input}</span>
                  </div>
                ))}
              </details>
            )}
          </div>
        )}

        {pro === false && (
          <div style={S.lockTeaser}>
            <div style={S.watchHead}>🔔 Monitors &amp; Watchlists <span style={{ color: '#567', fontWeight: 400 }}>· Pro</span></div>
            <p style={{ color: '#8aa', fontSize: 13.5, lineHeight: 1.6, margin: '0 0 12px' }}>
              The world doesn't stop when you close the tab. Pro lets Ozzie <b style={{ color: '#cfe' }}>watch 24/7</b> — say
              "alert me on active fires in the USA" or "earthquakes over M6" and Ozzie emails you the moment it happens.
              On Free, you're flying blind between checks.
            </p>
            <button style={{ ...S.btn, opacity: upgrading ? 0.6 : 1 }} onClick={upgrade} disabled={upgrading}>{upgrading ? '…' : 'Turn on 24/7 monitoring — Pro $49/mo →'}</button>
          </div>
        )}

        {pro && (
          <div style={S.watch}>
            <div style={S.watchHead}>📌 Watchlist <span style={{ color: '#567', fontWeight: 400 }}>· Ozzie rescans daily &amp; emails a digest</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input style={{ ...S.input, padding: '10px 12px', fontSize: 14 }} placeholder="add a target to monitor…" value={watchInput} onChange={(e) => setWatchInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && watchInput.trim() && watch('add', watchInput.trim().toLowerCase())} />
              <button style={{ ...S.btn, padding: '10px 16px', fontSize: 14 }} onClick={() => watchInput.trim() && watch('add', watchInput.trim().toLowerCase())}>Add</button>
            </div>
            {watchlist.length === 0 ? <div style={{ color: '#567', fontSize: 13 }}>No targets yet.</div> :
              watchlist.map((w) => (
                <div key={w} style={S.watchRow}>
                  <span style={{ color: '#cfe' }}>{w}</span>
                  <span>
                    <button style={S.miniBtn} onClick={() => { setTarget(w); setTimeout(investigate, 0); }}>investigate</button>
                    <button style={{ ...S.miniBtn, color: '#f88' }} onClick={() => watch('remove', w)}>remove</button>
                  </span>
                </div>
              ))}
          </div>
        )}

        {pro && (
          <div style={S.watch}>
            <div style={S.watchHead}>🔔 Monitors <span style={{ color: '#567', fontWeight: 400 }}>· Ozzie watches live feeds &amp; emails you the moment they trip</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input style={{ ...S.input, padding: '10px 12px', fontSize: 14 }} placeholder="Tell Ozzie what to watch — e.g. active fires in the USA" value={monInput} disabled={monBusy}
                onChange={(e) => setMonInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMonitor()} />
              <button style={{ ...S.btn, padding: '10px 16px', fontSize: 14, opacity: monBusy ? 0.6 : 1 }} onClick={addMonitor} disabled={monBusy}>{monBusy ? '…' : 'Watch'}</button>
            </div>
            {monErr && <div style={{ color: '#f88', fontSize: 12, marginBottom: 6 }}>{monErr}</div>}
            {monitors.length === 0 ? <div style={{ color: '#567', fontSize: 13 }}>No monitors yet. Try “earthquakes over magnitude 6” or “active fires in the USA”.</div> :
              monitors.map((m) => (
                <div key={m.id} style={S.watchRow}>
                  <span style={{ color: '#cfe' }}><span style={S.monType}>{m.type}</span> {m.label}</span>
                  <button style={{ ...S.miniBtn, color: '#f88' }} onClick={() => removeMonitor(m.id)}>remove</button>
                </div>
              ))}
          </div>
        )}

        <footer style={S.footer}>
          Osiris · open-source intelligence · <a href="/" style={{ color: '#00E5FF' }}>← back to the globe</a>
        </footer>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1200px 600px at 50% -10%, #0a1420, #05080d 60%)', color: '#cfe', fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: '0' },
  wrap: { maxWidth: 880, margin: '0 auto', padding: '48px 20px 80px' },
  header: { textAlign: 'center', marginBottom: 32 },
  logo: { fontSize: 34, fontWeight: 800, letterSpacing: 4, color: '#eaf6ff', textShadow: '0 0 20px rgba(0,229,255,0.4)' },
  tag: { fontSize: 13, color: '#5f7a8a', letterSpacing: 1, marginTop: 6 },
  bar: { display: 'flex', gap: 10, marginBottom: 14 },
  input: { flex: 1, padding: '14px 16px', borderRadius: 10, border: '1px solid #1d3b4d', background: '#0a1622', color: '#eaf6ff', fontSize: 15, outline: 'none' },
  btn: { padding: '14px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#00E5FF,#0091b3)', color: '#02121a', fontWeight: 700, fontSize: 15, cursor: 'pointer' },
  note: { fontSize: 13, color: '#7fa', padding: '10px 2px' },
  results: { marginTop: 18 },
  meta: { display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: '#8aa', borderBottom: '1px solid #16303f', paddingBottom: 10, marginBottom: 16 },
  dossier: { background: '#08131d', border: '1px solid #16303f', borderRadius: 12, padding: '22px 26px', lineHeight: 1.7, fontSize: 14.5 },
  trace: { marginTop: 16, background: '#070f17', border: '1px solid #122636', borderRadius: 10, padding: '10px 14px' },
  summary: { cursor: 'pointer', color: '#9bd', fontSize: 13 },
  traceRow: { display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', fontSize: 13 },
  toolTag: { background: '#0d2433', color: '#00E5FF', borderRadius: 6, padding: '2px 8px', fontFamily: 'monospace', fontSize: 12 },
  footer: { marginTop: 40, textAlign: 'center', fontSize: 12, color: '#456' },
  paywall: { background: '#08131d', border: '1px solid #16303f', borderRadius: 14, padding: '28px 30px', maxWidth: 480, margin: '0 auto', textAlign: 'center' },
  pwTitle: { fontSize: 13, letterSpacing: 2, color: '#00E5FF', fontWeight: 700, textTransform: 'uppercase' },
  pwPrice: { fontSize: 46, fontWeight: 800, color: '#eaf6ff', margin: '4px 0 14px' },
  pwList: { textAlign: 'left', color: '#bcd', fontSize: 14, lineHeight: 1.9, margin: '0 0 18px', paddingLeft: 20 },
  watch: { marginTop: 24, background: '#070f17', border: '1px solid #122636', borderRadius: 12, padding: '18px 20px' },
  watchHead: { fontSize: 14, fontWeight: 700, color: '#9bd', marginBottom: 12 },
  watchRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #0e1f2b', fontSize: 14 },
  miniBtn: { background: 'none', border: '1px solid #1d3b4d', color: '#9bd', borderRadius: 6, padding: '3px 10px', marginLeft: 6, cursor: 'pointer', fontSize: 12 },
  monType: { background: '#0d2433', color: '#00E5FF', borderRadius: 5, padding: '1px 7px', fontFamily: 'monospace', fontSize: 11, marginRight: 6 },
  freeBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#0a1825', border: '1px solid #16303f', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#8aa' },
  bannerUpgrade: { background: 'linear-gradient(135deg,#00E5FF,#0091b3)', color: '#02121a', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  lock: { marginTop: 16, background: 'linear-gradient(135deg,#0c1d2a,#10131c)', border: '1px solid #1d5566', borderRadius: 12, padding: '20px 22px', textAlign: 'center' },
  lockTitle: { fontSize: 17, fontWeight: 800, color: '#eaf6ff' },
  lockSub: { fontSize: 13.5, color: '#9bb', marginTop: 8, lineHeight: 1.6 },
  lockTeaser: { marginTop: 24, background: '#070f17', border: '1px dashed #1d5566', borderRadius: 12, padding: '20px 22px' },
};
