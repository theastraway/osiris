/**
 * Ozzie SENSE — the preprocessing / abstraction layer (MIND-style: MAL · sense · EQ).
 * Every raw OSINT item passes through owl BEFORE it reaches the knowledge graph:
 *   • normalize  → canonical entities + relationships (MAL)
 *   • perceive   → analyst summary, classification, tags (sense)
 *   • score      → significance 0–1; noise is dropped (EQ)
 * The result is a structured, entity-rich document — not raw feed text — so the
 * graph MIND builds is clean and high-signal. owl is free, so this is ~free.
 */
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OZZIE_MODEL || 'openrouter/owl-alpha';
const FALLBACK = process.env.OZZIE_FALLBACK_MODEL || 'anthropic/claude-3.5-haiku';
const THRESHOLD = Number(process.env.SENSE_THRESHOLD || 0.35);   // below this = noise, dropped

export interface Sensed { title: string; content: string; tags: string[]; significance: number }

async function owl(prompt: string): Promise<string> {
  const call = async (model: string) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://osiris.theastraway.com', 'X-Title': 'Osiris Ozzie' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 600 }),
      signal: AbortSignal.timeout(35000),
    });
    if (!r.ok) throw new Error(`${model} ${r.status}`);
    return (await r.json()).choices?.[0]?.message?.content?.trim() || '';
  };
  try { return await call(MODEL); } catch { return await call(FALLBACK); }
}

function parse(raw: string): Record<string, unknown> | null {
  let s = raw.replace(/<\/?longcat[^>]*>/g, '').trim();
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) s = f[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch {
    try { return JSON.parse(s.slice(a, b + 1).replace(/[\n\r\t]/g, ' ')); } catch { return null; }
  }
}

/** Process one raw item → structured doc, or null if below the significance threshold. */
export async function sense(raw: { title: string; content: string; baseTags: string[] }): Promise<Sensed | null> {
  if (!OPENROUTER_KEY) return { title: raw.title, content: raw.content, tags: raw.baseTags, significance: 1 }; // no owl → pass through raw
  const prompt = `You are the SENSE layer of Ozzie, an OSINT analyst. Turn this raw intelligence item into structured analyst form. Respond with ONLY JSON:
{"significance":0.0-1.0,"title":"normalized one-line title","summary":"2-3 sentence analyst summary of the key facts and why it matters","entities":[{"name":"canonical name","type":"organization|person|product|location|cve|agency|vessel|wallet|event"}],"relationships":["EntityA — relation — EntityB"],"tags":["..."]}
significance: 0.2=noise/boilerplate, 0.5=routine, 0.8=notable, 0.95=critical for an analyst.
RAW ITEM
title: ${raw.title}
content: ${raw.content.slice(0, 2000)}`;
  let o: Record<string, unknown> | null = null;
  try { o = parse(await owl(prompt)); } catch { o = null; }
  if (!o) return { title: raw.title, content: raw.content, tags: raw.baseTags, significance: 0.5 }; // parse fail → keep raw, don't lose data
  const sig = Number(o.significance ?? 0.5);
  if (sig < THRESHOLD) return null;  // dropped as noise

  const entities = (o.entities as Array<{ name: string; type: string }> | undefined) || [];
  const rels = (o.relationships as string[] | undefined) || [];
  const tags = [...new Set([...(raw.baseTags || []), ...((o.tags as string[]) || []).map((t) => String(t).toLowerCase().slice(0, 24))])].slice(0, 10);
  const content = [
    `# ${o.title || raw.title}`,
    `${o.summary || ''}`,
    entities.length ? `\n## Entities\n${entities.map((e) => `- ${e.name} (${e.type})`).join('\n')}` : '',
    rels.length ? `\n## Relationships\n${rels.map((r) => `- ${r}`).join('\n')}` : '',
    `\nSignificance: ${sig.toFixed(2)}.`,
    `\n---\n${raw.content.slice(0, 1200)}`,
  ].filter(Boolean).join('\n');
  return { title: String(o.title || raw.title).slice(0, 120), content, tags, significance: sig };
}
