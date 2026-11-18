// Long background work (reading books, building a program) that outlives the
// request that started it. One job per key at a time; progress and errors are
// kept in the database, so a restarted server can pick the work up again.
const g = globalThis as unknown as { __tutorJobs?: Map<string, Promise<void>> };
const jobs = (g.__tutorJobs ??= new Map());

export const isJobRunning = (key: string) => jobs.has(key);

/** Start `work` unless a job with this key is already running. Returns false if it was. */
export function startJob(key: string, work: () => Promise<void>): boolean {
  if (jobs.has(key)) return false;
  const p = work()
    .catch((e) => console.error(`job ${key}:`, e))
    .finally(() => jobs.delete(key));
  jobs.set(key, p);
  return true;
}

/** For tests: wait until the job with this key (if any) is finished. */
export async function waitJob(key: string) {
  await jobs.get(key);
}
