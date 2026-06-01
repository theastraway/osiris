/** POST /api/billing/checkout {email} → Stripe Checkout (subscription) URL for Osiris Pro. */
import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_KEY, STRIPE_PRICE_PRO, PUBLIC_URL } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!STRIPE_KEY || !STRIPE_PRICE_PRO) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });
  const { email } = await req.json().catch(() => ({ email: '' }));
  const params: Record<string, string> = {
    'mode': 'subscription',
    'line_items[0][price]': STRIPE_PRICE_PRO,
    'line_items[0][quantity]': '1',
    'success_url': `${PUBLIC_URL}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${PUBLIC_URL}/ozzie?checkout=cancelled`,
    'allow_promotion_codes': 'true',
  };
  if (email) params['customer_email'] = email;
  const session = await stripe('checkout/sessions', params);
  if (!session.url) return NextResponse.json({ error: 'Stripe error', detail: session }, { status: 502 });
  return NextResponse.json({ url: session.url });
}
