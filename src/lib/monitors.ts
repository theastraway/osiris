/**
 * Ozzie Monitors — live-feed alert rules (fires, earthquakes, …).
 * File-backed on the /data volume (no DB). Each monitor watches a platform feed
 * for a condition; the cron scan evaluates them, emails on trigger, and dedups
 * via per-monitor state so you aren't spammed.
 */
import fs from 'fs/promises';

const SELF = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const DIR = process.env.OSIRIS_DATA_DIR || '/data';
const PATH = `${DIR}/monitors.json`;

export interface Monitor {
  id: string;
  label: string;
  type: 'fires' | 'earthquake';
  params: Record<string, number | string>;
  cooldownMin: number;
  lastAlert: number;        // epoch ms
  state: Record<string, unknown>;
}

export async function listMonitors(): Promise<Monitor[]> {
  try { return JSON.parse(await fs.readFile(PATH, 'utf8')); } catch { return []; }
}
export async function saveMonitors(m: Monitor[]): Promise<void> {
  try { await fs.mkdir(DIR, { recursive: true }); } catch { /* exists */ }
  await fs.writeFile(PATH, JSON.stringify(m.slice(0, 50)));
}

// US bounding boxes: CONUS, Alaska, Hawaii.
function isUS(lat: number, lng: number): boolean {
  return (
    (lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66.5) ||
    (lat >= 51 && lat <= 71.5 && lng >= -170 && lng <= -129) ||
    (lat >= 18.5 && lat <= 22.5 && lng >= -160.5 && lng <= -154.5)
  );
}
const REGIONS: Record<string, (la: number, ln: number) => boolean> = {
  us: isUS,
  global: () => true,
};

async function feed(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${SELF}${path}`, { signal: AbortSignal.timeout(20000) });
  return r.json();
}

export interface EvalResult { triggered: boolean; message?: string; state: Record<string, unknown>; }

/** Evaluate one monitor against live data. Pure-ish: returns next state + optional alert. */
export async function evaluate(m: Monitor): Promise<EvalResult> {
  if (m.type === 'fires') {
    const region = String(m.params.region || 'us');
    const minFrp = Number(m.params.minFrp ?? 20);     // fire radiative power → "large" fire
    const inRegion = REGIONS[region] || isUS;
    const data = (await feed('/api/fires')) as { fires?: Array<{ lat: number; lng: number; frp: number; confidence: string }> };
    const fires = (data.fires || []).filter((f) => inRegion(f.lat, f.lng));
    const large = fires.filter((f) => f.frp >= minFrp);
    const prev = Number(m.state.largeCount ?? -1);
    const nextState = { largeCount: large.length, totalCount: fires.length };
    // Trigger when large-fire count rises vs last check (new significant activity).
    if (prev >= 0 && large.length > prev) {
      const top = [...large].sort((a, b) => b.frp - a.frp).slice(0, 5)
        .map((f) => `• ${f.lat.toFixed(2)}, ${f.lng.toFixed(2)} — FRP ${f.frp.toFixed(0)} (${f.confidence})`).join('\n');
      return { triggered: true, state: nextState,
        message: `🔥 ${large.length} large active fires detected in ${region.toUpperCase()} (was ${prev}; ${fires.length} total). Strongest:\n${top}` };
    }
    return { triggered: false, state: nextState };
  }

  if (m.type === 'earthquake') {
    const minMag = Number(m.params.minMagnitude ?? 6);
    const region = String(m.params.region || 'global');
    const inRegion = REGIONS[region] || (() => true);
    const data = (await feed('/api/earthquakes')) as { earthquakes?: Array<{ id: string; magnitude: number; place: string; lat: number; lng: number; url: string }> };
    const seen: string[] = Array.isArray(m.state.seenIds) ? (m.state.seenIds as string[]) : [];
    const qualifying = (data.earthquakes || []).filter((q) => q.magnitude >= minMag && inRegion(q.lat, q.lng));
    const fresh = qualifying.filter((q) => !seen.includes(q.id));
    const nextState = { seenIds: [...seen, ...fresh.map((q) => q.id)].slice(-500) };
    if (fresh.length) {
      const lines = fresh.map((q) => `• M${q.magnitude} — ${q.place} (${q.url})`).join('\n');
      return { triggered: true, state: nextState, message: `🌎 ${fresh.length} new M≥${minMag} earthquake(s) in ${region.toUpperCase()}:\n${lines}` };
    }
    return { triggered: false, state: nextState };
  }

  return { triggered: false, state: m.state };
}

/** Map a natural-language phrase to a monitor config via owl-alpha. */
export async function parseMonitor(text: string): Promise<{ type: string; params: Record<string, unknown>; label: string } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const prompt = `Map the user's alert request to ONE monitor config. Respond with ONLY compact JSON.
Supported types:
- "fires": params {region:"us"|"global", minFrp:number(default 20)} — active wildfires.
- "earthquake": params {minMagnitude:number(default 6), region:"us"|"global"} — earthquakes.
Pick the closest type, fill params, and write a short human label.
Output: {"type":"...","params":{...},"label":"..."}
User request: "${text}"`;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model: process.env.OZZIE_MODEL || 'openrouter/free', messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 200 }),
      signal: AbortSignal.timeout(30000),
    });
    let s = (await r.json()).choices?.[0]?.message?.content?.trim() || '';
    const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) s = f[1];
    s = s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
    const o = JSON.parse(s);
    if (o.type === 'fires' || o.type === 'earthquake') return { type: o.type, params: o.params || {}, label: o.label || text };
    return null;
  } catch { return null; }
}
