/** GET /api/billing/confirm?session_id=... → verify paid → set Pro cookie → redirect to /ozzie. */
import { NextRequest, NextResponse } from 'next/server';
import { stripe, signSession, PRO_COOKIE, PUBLIC_URL } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('session_id');
  if (!id) return NextResponse.redirect(`${PUBLIC_URL}/ozzie?checkout=error`);
  const session = await stripe(`checkout/sessions/${id}`, undefined, 'GET');
  const paid = session.payment_status === 'paid' || session.status === 'complete';
  if (!paid) return NextResponse.redirect(`${PUBLIC_URL}/ozzie?checkout=incomplete`);
  const email = (session.customer_details as { email?: string } | undefined)?.email || (session.customer_email as string) || 'pro-user';
  const cookie = signSession({ email, sub: String(session.subscription || 'sub'), days: 31 });
  const res = NextResponse.redirect(`${PUBLIC_URL}/ozzie?welcome=pro`);
  res.cookies.set(PRO_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 31 * 86400 });
  return res;
}
