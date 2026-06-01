/** GET/POST /api/ozzie/monitors — Pro-gated. Manage Ozzie's live-feed alert rules. */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, PRO_COOKIE } from '@/lib/billing';
import { listMonitors, saveMonitors, parseMonitor, type Monitor } from '@/lib/monitors';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const gate = (req: NextRequest) => Boolean(verifySession(req.cookies.get(PRO_COOKIE)?.value));
const id = () => `m_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'Osiris Pro required' }, { status: 402 });
  const m = await listMonitors();
  return NextResponse.json({ monitors: m.map(({ id, label, type, params, cooldownMin }) => ({ id, label, type, params, cooldownMin })) });
}

export async function POST(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'Osiris Pro required' }, { status: 402 });
  const body = await req.json().catch(() => ({}));
  const list = await listMonitors();

  if (body.action === 'remove') {
    await saveMonitors(list.filter((m) => m.id !== body.id));
    return NextResponse.json({ monitors: (await listMonitors()).map((m) => ({ id: m.id, label: m.label, type: m.type, params: m.params })) });
  }

  let cfg: { type: string; params: Record<string, unknown>; label: string } | null = null;
  if (body.action === 'add_nl' && body.text) {
    cfg = await parseMonitor(String(body.text));
    if (!cfg) return NextResponse.json({ error: "Couldn't interpret that. Try e.g. 'active fires in the USA' or 'earthquakes over magnitude 6'." }, { status: 422 });
  } else if (body.type) {
    cfg = { type: body.type, params: body.params || {}, label: body.label || body.type };
  }
  if (!cfg) return NextResponse.json({ error: 'Provide text (add_nl) or type' }, { status: 400 });

  const monitor: Monitor = { id: id(), label: cfg.label, type: cfg.type as Monitor['type'], params: cfg.params as Monitor['params'], cooldownMin: Number(body.cooldownMin ?? 180), lastAlert: 0, state: {} };
  await saveMonitors([...list, monitor]);
  return NextResponse.json({ added: { id: monitor.id, label: monitor.label, type: monitor.type, params: monitor.params }, monitors: (await listMonitors()).map((m) => ({ id: m.id, label: m.label, type: m.type, params: m.params })) });
}
