/**
 * POST /api/ozzie/cron/watchlist-scan  (header X-Cron-Secret)
 * Re-investigates every watchlist entity via Ozzie (service-auth bypass),
 * then emails a digest. Dossiers auto-persist to the @ozzie graph; future
 * versions diff against the prior dossier to alert only on material change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWatchlist, sendEmail } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SELF = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const BRIEF_EMAIL = process.env.OZZIE_BRIEF_EMAIL || 'anthony@theastraway.com';

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const targets = await getWatchlist();
  if (!targets.length) return NextResponse.json({ ok: true, scanned: 0, note: 'watchlist empty' });

  const results: Array<{ target: string; ok: boolean; summary: string }> = [];
  for (const target of targets) {
    try {
      const r = await fetch(`${SELF}/api/ozzie/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ozzie-service': process.env.CRON_SECRET! },
        body: JSON.stringify({ target }),
        signal: AbortSignal.timeout(200000),
      });
      const d = await r.json().catch(() => ({}));
      const dossier = (d.dossier || '') as string;
      const summary = (dossier.match(/##\s*Summary\s*([\s\S]*?)(?:\n##|$)/i)?.[1] || dossier).trim().slice(0, 280);
      results.push({ target, ok: r.ok, summary });
    } catch { results.push({ target, ok: false, summary: 'scan failed' }); }
  }

  const date = new Date().toISOString().slice(0, 10);
  const rows = results.map((x) => `<li><b>${x.target}</b>: ${x.summary.replace(/</g, '&lt;')}</li>`).join('');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px"><h2>🛰️ Ozzie Watchlist Scan — ${date}</h2><ul style="line-height:1.6">${rows}</ul><hr/><small>Osiris · osiris.theastraway.com/ozzie</small></div>`;
  const text = results.map((x) => `${x.target}: ${x.summary}`).join('\n\n');
  const emailed = await sendEmail(BRIEF_EMAIL, `🛰️ Ozzie Watchlist Scan — ${date} (${results.length} targets)`, html, text);

  return NextResponse.json({ ok: true, scanned: results.length, emailed, results: results.map((r) => ({ target: r.target, ok: r.ok })) });
}
