/**
 * Ingestion sources — each returns NEW items since the prior cursor, formatted as
 * documents for the @ozzie knowledge graph. Keyless public-record feeds only.
 * Adding a source = add one fetcher to SOURCES. The dispatcher handles dedup,
 * volume caps, cursor persistence, and posting to MIND.
 */
type Item = { title: string; content: string; tags: string[] };
export type FetchResult = { items: Item[]; cursor: string };
const SELF = process.env.OSIRIS_SELF_BASE || 'http://localhost:3000';
const UA = 'OsirisOzzie/1.0 (intel@theastraway.com)';

async function getJSON(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return null; }   // upstream returned a text error / rate-limit notice
}
async function getText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  return r.text();
}

/* ── TIER 1 · cyber vulnerabilities (NVD) ── */
async function cve(prev: string): Promise<FetchResult> {
  const end = new Date(); const start = new Date(end.getTime() - 24 * 3600_000);
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${start.toISOString().slice(0, 23)}&pubEndDate=${end.toISOString().slice(0, 23)}&cvssV3Severity=CRITICAL`;
  const d = (await getJSON(url)) as { vulnerabilities?: Array<{ cve: { id: string; published: string; descriptions: Array<{ lang: string; value: string }>; metrics?: { cvssMetricV31?: Array<{ cvssData: { baseScore: number } }> } } }> } | null;
  if (!d || !d.vulnerabilities) return { items: [], cursor: prev };
  const items: Item[] = [];
  let cursor = prev;
  for (const v of d.vulnerabilities || []) {
    const id = v.cve.id; if (id <= prev) continue;
    if (id > cursor) cursor = id;
    const desc = v.cve.descriptions?.find((x) => x.lang === 'en')?.value || '';
    const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ?? '?';
    items.push({ title: `CVE ${id} (CVSS ${score})`, content: `# ${id}\nPublished: ${v.cve.published}\nCVSS: ${score} (Critical)\n\n${desc}\n\nSource: NVD (nvd.nist.gov). Entity type: cve.`, tags: ['ozzie', 'ingest', 'cve', 'cyber'] });
  }
  return { items, cursor };
}

/* ── TIER 1 · corporate / financial material events (SEC EDGAR 8-K) ── */
async function edgar(prev: string): Promise<FetchResult> {
  const xml = await getText('https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom&count=30');
  const entries = xml.split('<entry>').slice(1);
  const items: Item[] = []; let cursor = prev;
  for (const e of entries) {
    const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim();
    const updated = (e.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || '').trim();
    const link = (e.match(/<link[^>]*href="([^"]+)"/)?.[1] || '').trim();
    const key = updated + title;
    if (!title || key <= prev) continue;
    if (key > cursor) cursor = key;
    items.push({ title: `SEC 8-K: ${title}`.slice(0, 120), content: `# SEC EDGAR 8-K filing\n${title}\nFiled: ${updated}\n${link}\n\nMaterial corporate event. Source: SEC EDGAR (sec.gov). Entity type: organization, filing.`, tags: ['ozzie', 'ingest', 'edgar', 'corporate', 'financial'] });
  }
  return { items, cursor };
}

/* ── TIER 2 · global events (GDELT DOC API) ── */
async function gdelt(prev: string): Promise<FetchResult> {
  const q = encodeURIComponent('(sanctions OR cyberattack OR "data breach" OR sanctioned OR espionage OR "money laundering")');
  const d = (await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=25&format=json&timespan=45min`)) as { articles?: Array<{ url: string; title: string; seendate: string; domain: string; sourcecountry: string }> } | null;
  if (!d || !d.articles) return { items: [], cursor: prev };   // rate-limited / no JSON → skip this tick
  const items: Item[] = []; let cursor = prev; const seen = new Set(prev.split('|'));
  for (const a of d.articles || []) {
    if (!a.url || seen.has(a.url)) continue;
    items.push({ title: `Event: ${a.title}`.slice(0, 120), content: `# ${a.title}\nSource: ${a.domain} (${a.sourcecountry})\nSeen: ${a.seendate}\n${a.url}\n\nGlobal intelligence event. Source: GDELT. Entity types: event, organization, location.`, tags: ['ozzie', 'ingest', 'gdelt', 'event'] });
  }
  cursor = (d.articles || []).slice(0, 30).map((a) => a.url).join('|') || prev;
  return { items, cursor };
}

/* ── TIER 2 · major seismic events (via our own live feed) ── */
async function quakes(prev: string): Promise<FetchResult> {
  const d = (await getJSON(`${SELF}/api/earthquakes`)) as { earthquakes?: Array<{ id: string; magnitude: number; place: string; time: number; url: string; lat: number; lng: number }> } | null;
  if (!d || !d.earthquakes) return { items: [], cursor: prev };
  const items: Item[] = []; let cursor = prev; const seen = new Set(prev.split('|'));
  for (const q of (d.earthquakes || []).filter((x) => x.magnitude >= 5.5)) {
    if (seen.has(q.id)) continue;
    items.push({ title: `M${q.magnitude} earthquake — ${q.place}`.slice(0, 120), content: `# M${q.magnitude} earthquake\nLocation: ${q.place}\nCoordinates: ${q.lat}, ${q.lng}\n${q.url}\n\nSource: USGS. Entity types: event, location.`, tags: ['ozzie', 'ingest', 'seismic', 'event'] });
  }
  cursor = (d.earthquakes || []).slice(0, 60).map((q) => q.id).join('|') || prev;
  return { items, cursor };
}

/* ── TIER 1 · actively-exploited vulnerabilities (CISA KEV, via our feed) ── */
async function cyber(prev: string): Promise<FetchResult> {
  const d = (await getJSON(`${SELF}/api/cyber-threats`)) as { threats?: Array<{ id: string; name: string; vendor: string; product: string; severity: string; date: string; source: string }> } | null;
  if (!d || !d.threats) return { items: [], cursor: prev };
  const items: Item[] = []; const seen = new Set(prev.split('|'));
  for (const t of d.threats) {
    if (seen.has(t.id)) continue;
    items.push({ title: `${t.id}: ${t.name}`.slice(0, 120), content: `# ${t.name}\nID: ${t.id}\nVendor: ${t.vendor} · Product: ${t.product}\nSeverity: ${t.severity} · Added: ${t.date}\nSource: ${t.source} — CISA Known Exploited Vulnerabilities (actively exploited in the wild).\nEntity types: cve, organization, product.`, tags: ['ozzie', 'ingest', 'cyber', 'kev', 'cve'] });
  }
  return { items, cursor: d.threats.slice(0, 80).map((t) => t.id).join('|') || prev };
}

/* ── TIER 1 · US federal contract awards (USAspending) ── */
async function contracts(prev: string): Promise<FetchResult> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const body = { filters: { award_type_codes: ['A', 'B', 'C', 'D'], time_period: [{ start_date: start, end_date: today }] }, fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Description'], sort: 'Award Amount', order: 'desc', limit: 20 };
  let d: { results?: Array<Record<string, unknown>> } | null = null;
  try {
    const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    const t = await r.text(); d = JSON.parse(t);
  } catch { return { items: [], cursor: prev }; }
  const results = d?.results || []; const items: Item[] = []; const seen = new Set(prev.split('|'));
  for (const a of results) {
    const id = String(a['Award ID'] || a['generated_internal_id'] || '');
    if (!id || seen.has(id)) continue;
    items.push({ title: `Federal award: ${a['Recipient Name']} ($${a['Award Amount']})`.slice(0, 120), content: `# US federal contract award\nRecipient: ${a['Recipient Name']}\nAmount: $${a['Award Amount']}\nAgency: ${a['Awarding Agency']}\nAward ID: ${id}\n${a['Description'] || ''}\n\nSource: USAspending.gov. Entity types: organization, government_agency, contract.`, tags: ['ozzie', 'ingest', 'contracts', 'financial', 'government'] });
  }
  return { items, cursor: results.map((a) => String(a['Award ID'] || '')).join('|') || prev };
}

export const SOURCES: Record<string, (prev: string) => Promise<FetchResult>> = { cve, cyber, edgar, contracts, gdelt, quakes };
