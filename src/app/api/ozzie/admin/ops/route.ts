/**
 * POST /api/ozzie/admin/ops  (admin-gated)  { action }
 *  - overview      → automations registry + last-run/status + run log + monitors + watchlist
 *  - run {job}     → trigger an automation now
 *  - add_monitor {text} / remove_monitor {id}  → manage "alert me when X" rules
 * The Ozzie Operations dashboard backend.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, ADMIN_COOKIE } from '@/lib/billing';
import { getRunLog, lastRuns } from '@/lib/runlog';
import { listMonitors, saveMonitors, parseMonitor, type Monitor } from '@/lib/monitors';
import { getWatchlist } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const SELF = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const CRON = process.env.CRON_SECRET || '';
const newId = () => `m_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

const JOBS = [
  { key: 'monitors', name: 'Live-feed Monitors', cadence: 'every 20 min', cat: 'alerts', path: '/api/ozzie/cron/monitor-scan' },
  { key: 'analyst', name: 'Autonomous Analyst', cadence: 'every 30 min', cat: 'analysis', path: '/api/ozzie/cron/analyst' },
  { key: 'intel-report', name: 'Intelligence Report', cadence: 'daily · 14:00 UTC', cat: 'reporting', path: '/api/ozzie/cron/intel-report' },
  { key: 'daily-brief', name: 'Daily Brief', cadence: 'daily · 12:00 UTC', cat: 'reporting', path: '/api/ozzie/cron/daily-brief' },
  { key: 'watchlist', name: 'Watchlist Scan', cadence: 'daily · 13:00 UTC', cat: 'monitoring', path: '/api/ozzie/cron/watchlist-scan' },
  { key: 'social', name: 'Auto Social Post', cadence: 'daily · 16:00 UTC', cat: 'social', path: '/api/ozzie/cron/social' },
  { key: 'ingest:cve', name: 'Ingest · CVE/NVD', cadence: 'hourly :05', cat: 'ingestion', path: '/api/ozzie/ingest?source=cve' },
  { key: 'ingest:cyber', name: 'Ingest · CISA KEV', cadence: 'hourly :15', cat: 'ingestion', path: '/api/ozzie/ingest?source=cyber' },
  { key: 'ingest:edgar', name: 'Ingest · SEC EDGAR', cadence: '2×/hr', cat: 'ingestion', path: '/api/ozzie/ingest?source=edgar' },
  { key: 'ingest:gdelt', name: 'Ingest · GDELT', cadence: '2×/hr', cat: 'ingestion', path: '/api/ozzie/ingest?source=gdelt' },
  { key: 'ingest:quakes', name: 'Ingest · USGS', cadence: 'hourly :35', cat: 'ingestion', path: '/api/ozzie/ingest?source=quakes' },
  { key: 'ingest:contracts', name: 'Ingest · USAspending', cadence: 'hourly :50', cat: 'ingestion', path: '/api/ozzie/ingest?source=contracts' },
];

export async function POST(req: NextRequest) {
  if (!isAdmin(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: 'admin required' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === 'overview') {
    const last = await lastRuns();
    const jobs = JOBS.map((j) => ({ ...j, last: last[j.key] || null }));
    return NextResponse.json({ jobs, runlog: (await getRunLog()).slice(0, 60), monitors: (await listMonitors()).map((m) => ({ id: m.id, label: m.label, type: m.type, lastAlert: m.lastAlert })), watchlist: await getWatchlist() });
  }

  if (action === 'run') {
    const j = JOBS.find((x) => x.key === body.job);
    if (!j) return NextResponse.json({ error: 'unknown job' }, { status: 400 });
    try {
      const r = await fetch(`${SELF}${j.path}`, { method: 'POST', headers: { 'X-Cron-Secret': CRON }, signal: AbortSignal.timeout(230000) });
      return NextResponse.json({ ok: r.ok, result: await r.json().catch(() => ({})) });
    } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 }); }
  }

  if (action === 'add_monitor') {
    const cfg = await parseMonitor(String(body.text || ''));
    if (!cfg) return NextResponse.json({ error: "Couldn't interpret that — try 'active fires in the USA' or 'earthquakes over magnitude 6'." }, { status: 422 });
    const m: Monitor = { id: newId(), label: cfg.label, type: cfg.type as Monitor['type'], params: cfg.params as Monitor['params'], cooldownMin: 180, lastAlert: 0, state: {} };
    await saveMonitors([...(await listMonitors()), m]);
    return NextResponse.json({ monitors: (await listMonitors()).map((x) => ({ id: x.id, label: x.label, type: x.type })) });
  }
  if (action === 'remove_monitor') {
    await saveMonitors((await listMonitors()).filter((x) => x.id !== body.id));
    return NextResponse.json({ monitors: (await listMonitors()).map((x) => ({ id: x.id, label: x.label, type: x.type })) });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
