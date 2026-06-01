/** Resend email helper + tiny file-backed watchlist store (no DB). */
import fs from 'fs/promises';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.OSIRIS_FROM_EMAIL || 'Osiris <osiris@theastraway.com>';
const DIR = process.env.OSIRIS_DATA_DIR || '/data';
const WATCHLIST_PATH = `${DIR}/watchlist.json`;
const SETTINGS_PATH = `${DIR}/settings.json`;

export interface Settings { alertEmail: string; channels: { email: boolean }; monitorCadenceMin: number; quietHours?: [number, number] }
const DEFAULT_SETTINGS: Settings = { alertEmail: process.env.OZZIE_BRIEF_EMAIL || 'anthony@theastraway.com', channels: { email: true }, monitorCadenceMin: 20 };

export async function getSettings(): Promise<Settings> {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')) }; } catch { return DEFAULT_SETTINGS; }
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  try { await fs.mkdir(DIR, { recursive: true }); } catch { /* exists */ }
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next));
  return next;
}
/** Resolve where alerts go (configured destination, falling back to default). */
export async function alertDestination(): Promise<string | null> {
  const s = await getSettings();
  return s.channels.email ? s.alertEmail : null;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!RESEND_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], bcc: ['anthony@theastraway.com'], reply_to: 'anthony@theastraway.com', subject, html, text }),
      signal: AbortSignal.timeout(20000),
    });
    return r.ok;
  } catch { return false; }
}

export async function getWatchlist(): Promise<string[]> {
  try { return JSON.parse(await fs.readFile(WATCHLIST_PATH, 'utf8')); } catch { return []; }
}

export async function setWatchlist(items: string[]): Promise<void> {
  try { await fs.mkdir(WATCHLIST_PATH.replace(/\/[^/]+$/, ''), { recursive: true }); } catch { /* exists */ }
  await fs.writeFile(WATCHLIST_PATH, JSON.stringify([...new Set(items)].slice(0, 100)));
}
