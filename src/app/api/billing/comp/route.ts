/** GET /api/billing/comp?token=... → grant complimentary Pro (owner/testing). */
import { NextRequest, NextResponse } from 'next/server';
import { signSession, verifySession, PRO_COOKIE, COMP_TOKEN, PUBLIC_URL } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  // status check: ?status=1 reports current entitlement without granting
  if (req.nextUrl.searchParams.get('status')) {
    const s = verifySession(req.cookies.get(PRO_COOKIE)?.value);
    return NextResponse.json({ pro: Boolean(s), email: s?.email || null });
  }
  if (!COMP_TOKEN || token !== COMP_TOKEN) return NextResponse.json({ error: 'invalid comp token' }, { status: 403 });
  const res = NextResponse.redirect(`${PUBLIC_URL}/ozzie?welcome=comp`);
  res.cookies.set(PRO_COOKIE, signSession({ email: 'owner@osiris', sub: 'comp', days: 365 }), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 365 * 86400 });
  return res;
}
