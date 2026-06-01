'use client';

/* ═══════════════════════════════════════════════════════════════
   OZZIE — Investigation Console
   Standalone surface (osiris.theastraway.com/ozzie). Submit a target,
   Ozzie runs the recursive OSINT enrichment loop and returns a cited
   dossier + the tool trace. Persists to the @ozzie knowledge graph.
   ═══════════════════════════════════════════════════════════════ */
import { useState } from 'react';

interface TraceStep { step: number; tool?: string; input?: string; thought?: string; }
interface OzzieResult { target: string; dossier: string; steps: number; persisted_to_mind: boolean; trace: TraceStep[]; }

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

  async function investigate() {
    const t = target.trim();
    if (!t || loading) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/ozzie/investigate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      });
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

        <div style={S.bar}>
          <input
            style={S.input}
            placeholder="Enter a target — domain, IP, org, or person (e.g. openai.com)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && investigate()}
            disabled={loading}
          />
          <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} onClick={investigate} disabled={loading}>
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
            <details style={S.trace}>
              <summary style={S.summary}>Investigation trace ({result.trace.filter((t) => t.tool).length} tool calls)</summary>
              {result.trace.filter((t) => t.tool).map((t) => (
                <div key={t.step} style={S.traceRow}>
                  <span style={S.toolTag}>{t.tool}</span>
                  <span style={{ color: '#7a8' }}>{t.input}</span>
                </div>
              ))}
            </details>
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
};
