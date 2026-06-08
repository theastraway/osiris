/** GET /api/ozzie/admin/grant?token=... → admin session cookie → /ozzie/admin */
import { NextRequest, NextResponse } from 'next/server';
import { signAdmin, ADMIN_COOKIE, ADMIN_TOKEN, PUBLIC_URL } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return NextResponse.json({ error: 'invalid admin token' }, { status: 403 });
  const res = NextResponse.redirect(`${PUBLIC_URL}/ozzie/admin`);
  res.cookies.set(ADMIN_COOKIE, signAdmin(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
  return res;
}
