/** Resend email helper + tiny file-backed watchlist store (no DB). */
import fs from 'fs/promises';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.OSIRIS_FROM_EMAIL || 'Osiris <osiris@theastraway.com>';
const WATCHLIST_PATH = process.env.OSIRIS_DATA_DIR ? `${process.env.OSIRIS_DATA_DIR}/watchlist.json` : '/data/watchlist.json';

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
