/** Ozzie automation run-log — every cron/job execution recorded for the ops dashboard. */
import fs from 'fs/promises';
const PATH = `${process.env.OSIRIS_DATA_DIR || '/data'}/run_log.json`;

export interface Run { job: string; at: string; ok: boolean; summary: string }

export async function logRun(job: string, ok: boolean, summary: string): Promise<void> {
  try {
    let log: Run[] = [];
    try { log = JSON.parse(await fs.readFile(PATH, 'utf8')); } catch { /* new */ }
    log.unshift({ job, at: new Date().toISOString(), ok, summary: summary.slice(0, 200) });
    try { await fs.mkdir(PATH.replace(/\/[^/]+$/, ''), { recursive: true }); } catch { /* exists */ }
    await fs.writeFile(PATH, JSON.stringify(log.slice(0, 300)));
  } catch { /* logging is best-effort */ }
}
export async function getRunLog(): Promise<Run[]> {
  try { return JSON.parse(await fs.readFile(PATH, 'utf8')); } catch { return []; }
}
/** Latest run per job → { job: Run }. */
export async function lastRuns(): Promise<Record<string, Run>> {
  const log = await getRunLog(); const out: Record<string, Run> = {};
  for (const r of log) if (!out[r.job]) out[r.job] = r;
  return out;
}
