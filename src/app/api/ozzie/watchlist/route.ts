/** GET/POST /api/ozzie/watchlist — Pro-gated. Manage the entities Ozzie monitors. */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, PRO_COOKIE } from '@/lib/billing';
import { getWatchlist, setWatchlist } from '@/lib/notify';

export const dynamic = 'force-dynamic';

function gate(req: NextRequest): boolean {
  if (process.env.CRON_SECRET && req.headers.get('x-ozzie-service') === process.env.CRON_SECRET) return true;
  return Boolean(verifySession(req.cookies.get(PRO_COOKIE)?.value));
}

export async function GET(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'Osiris Pro required' }, { status: 402 });
  return NextResponse.json({ watchlist: await getWatchlist() });
}

export async function POST(req: NextRequest) {
  if (!gate(req)) return NextResponse.json({ error: 'Osiris Pro required' }, { status: 402 });
  const { action, target } = await req.json().catch(() => ({}));
  const t = (target || '').toString().trim().toLowerCase();
  if (!t) return NextResponse.json({ error: 'Missing target' }, { status: 400 });
  const list = await getWatchlist();
  const next = action === 'remove' ? list.filter((x) => x !== t) : [...list, t];
  await setWatchlist(next);
  return NextResponse.json({ watchlist: await getWatchlist() });
}
