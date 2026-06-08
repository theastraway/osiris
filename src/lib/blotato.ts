/**
 * Blotato client — Ozzie publishes intelligence to socials.
 * POST https://backend.blotato.com/v2/posts  (header blotato-api-key)
 *   { post: { target:{targetType}, content:{text,platform,mediaUrls}, accountId } }
 */
import fs from 'fs/promises';
const KEY = process.env.BLOTATO_API_KEY || '';
const BASE = process.env.BLOTATO_BASE_URL || 'https://backend.blotato.com';
const CONFIG = `${process.env.OSIRIS_DATA_DIR || '/data'}/social_config.json`;

export interface SocialConfig { enabled: boolean; autoChannels: string[] }
export async function getSocialConfig(): Promise<SocialConfig> {
  try { return { enabled: false, autoChannels: [], ...JSON.parse(await fs.readFile(CONFIG, 'utf8')) }; } catch { return { enabled: false, autoChannels: [] }; }
}
export async function setSocialConfig(c: SocialConfig): Promise<SocialConfig> {
  try { await fs.mkdir(CONFIG.replace(/\/[^/]+$/, ''), { recursive: true }); } catch { /* exists */ }
  await fs.writeFile(CONFIG, JSON.stringify(c)); return c;
}

export interface Channel { id: string; label: string; platform: string; accountId: string }

/** Connected channels, from env account ids. */
export function channels(): Channel[] {
  const c: Channel[] = [];
  const x = process.env.BLOTATO_ACCOUNT_ASTRAI_X; if (x) c.push({ id: 'x', label: 'Astra AI · X', platform: 'twitter', accountId: x });
  const li = process.env.BLOTATO_ACCOUNT_ANTHONY_LINKEDIN; if (li) c.push({ id: 'linkedin', label: 'Anthony · LinkedIn', platform: 'linkedin', accountId: li });
  const lip = process.env.BLOTATO_ACCOUNT_ASTRAI_LINKEDIN_PAGE; if (lip) c.push({ id: 'linkedin_page', label: 'Astra AI · LinkedIn Page', platform: 'linkedin', accountId: lip });
  const ig = process.env.BLOTATO_ACCOUNT_MINDAPP_INSTAGRAM; if (ig) c.push({ id: 'instagram', label: 'MINDapp · Instagram', platform: 'instagram', accountId: ig });
  return c;
}
export const blotatoAvailable = () => Boolean(KEY);

export async function publish(channel: Channel, text: string, mediaUrls: string[] = []): Promise<{ ok: boolean; status?: number; body?: unknown }> {
  if (!KEY) return { ok: false, body: 'BLOTATO_API_KEY missing' };
  const payload = { post: { target: { targetType: channel.platform }, content: { text, platform: channel.platform, mediaUrls }, accountId: channel.accountId } };
  try {
    const r = await fetch(`${BASE}/v2/posts`, {
      method: 'POST',
      headers: { 'blotato-api-key': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(40000),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, body: (e as Error).message }; }
}
