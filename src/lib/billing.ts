/**
 * Osiris billing/session — dependency-free.
 * Stripe is the source of truth (called via REST); entitlement rides in an
 * HMAC-signed HttpOnly cookie so there's no database to run.
 */
import crypto from 'crypto';

export const PRO_COOKIE = 'osiris_pro';
export const FREE_COOKIE = 'osiris_free';
export const FREE_DAILY = 2;          // free Ozzie investigations per day (summary-only)
const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
export const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
export const STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || '';
export const PUBLIC_URL = process.env.OSIRIS_PUBLIC_URL || 'https://osiris.theastraway.com';
export const COMP_TOKEN = process.env.OSIRIS_COMP_TOKEN || '';
export const PRO_PRICE_USD = 49;
export const ADMIN_COOKIE = 'osiris_admin';
export const ADMIN_TOKEN = process.env.OZZIE_ADMIN_TOKEN || '';
export const signAdmin = () => signSession({ email: 'admin@osiris', sub: 'admin', days: 30 });
export const isAdmin = (cookie: string | undefined) => verifySession(cookie)?.email === 'admin@osiris';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Sign a Pro session payload → cookie value. */
export function signSession(payload: { email: string; sub?: string; days?: number }): string {
  const body = { email: payload.email, sub: payload.sub || 'comp', exp: Date.now() + (payload.days ?? 30) * 86400_000 };
  const data = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Verify a cookie value → payload or null. */
export function verifySession(cookie: string | undefined): { email: string; sub: string; exp: number } | null {
  if (!cookie || !cookie.includes('.')) return null;
  const [data, sig] = cookie.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (typeof body.exp !== 'number' || body.exp < Date.now()) return null;
    return body;
  } catch { return null; }
}

/** Free-tier daily usage cookie {d:YYYY-MM-DD, n:count}, HMAC-signed. */
export function readFreeUsage(cookie: string | undefined): { d: string; n: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (cookie && cookie.includes('.')) {
    const [data, sig] = cookie.split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
      try { const b = JSON.parse(Buffer.from(data, 'base64url').toString()); if (b.d === today) return { d: today, n: Number(b.n) || 0 }; } catch { /* reset */ }
    }
  }
  return { d: today, n: 0 };
}
export function signFreeUsage(u: { d: string; n: number }): string {
  const data = b64u(JSON.stringify(u));
  return `${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

/** Split a dossier into the free Summary and the gated remainder (counts for the teaser). */
export function gateDossier(dossier: string): { summary: string; lockedFindings: number; lockedRiskFlags: number } {
  const idx = dossier.search(/##\s*Findings/i);
  const summary = idx > 0 ? dossier.slice(0, idx).trim() : dossier.split('\n').slice(0, 6).join('\n');
  const findings = (dossier.match(/^\s*[-*•]/gm) || []).length;
  const riskBlock = dossier.match(/##\s*Risk Flags([\s\S]*?)(?:\n##|$)/i)?.[1] || '';
  const riskFlags = (riskBlock.match(/^\s*[-*•]/gm) || []).length;
  return { summary, lockedFindings: Math.max(findings - riskFlags, 0), lockedRiskFlags: riskFlags };
}

/** Stripe REST helper (form-encoded). */
export async function stripe(path: string, params?: Record<string, string>, method = 'POST'): Promise<Record<string, unknown>> {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return r.json();
}
