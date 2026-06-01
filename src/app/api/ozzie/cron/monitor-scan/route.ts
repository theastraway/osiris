/**
 * POST /api/ozzie/cron/monitor-scan  (header X-Cron-Secret)
 * Evaluates every Ozzie monitor against live feeds; on a fresh trigger (respecting
 * each monitor's cooldown) it emails the alert and logs it to the @ozzie graph.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { listMonitors, saveMonitors, evaluate } from '@/lib/monitors';
import { sendEmail, alertDestination } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MIND_BASE = process.env.OSIRIS_MIND_BASE_URL || 'https://mindapp.onrender.com';
const MIND_KEY = process.env.OSIRIS_MIND_API_KEY || '';
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const ALERT_EMAIL = await alertDestination();   // configurable destination (chat/settings)
  const monitors = await listMonitors();
  const now = Date.now();
  const fired: Array<{ label: string; message: string }> = [];

  for (const m of monitors) {
    try {
      const res = await evaluate(m);
      m.state = res.state;                                   // always persist state (dedup/baseline)
      const cooled = now - (m.lastAlert || 0) >= m.cooldownMin * 60_000;
      if (res.triggered && res.message && cooled) {
        m.lastAlert = now;
        fired.push({ label: m.label, message: res.message });
        const subject = `🛰️ Ozzie Alert — ${m.label}`;
        const html = `<div style="font-family:system-ui,sans-serif;max-width:620px"><h3>${subject}</h3><pre style="white-space:pre-wrap;font-family:inherit;line-height:1.6">${res.message.replace(/</g, '&lt;')}</pre><hr/><small>Osiris · osiris.theastraway.com/ozzie</small></div>`;
        if (ALERT_EMAIL) await sendEmail(ALERT_EMAIL, subject, html, res.message);
        if (MIND_KEY) after(async () => {
          try {
            await fetch(`${MIND_BASE}/developer/v1/documents`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': MIND_KEY },
              body: JSON.stringify({ title: `Ozzie Alert - ${m.label} - ${new Date(now).toISOString()}`, content: res.message, source: 'Ozzie monitor', tags: ['ozzie', 'alert', m.type] }),
              signal: AbortSignal.timeout(45000),
            });
          } catch { /* best effort */ }
        });
      }
    } catch { /* skip this monitor this cycle */ }
  }

  await saveMonitors(monitors);
  return NextResponse.json({ ok: true, evaluated: monitors.length, fired: fired.length, alerts: fired.map((f) => f.label) });
}
