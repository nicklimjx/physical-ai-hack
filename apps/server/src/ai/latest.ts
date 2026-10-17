// One active job and one latest pending job. Superseded callers reject explicitly.
export function latestQueue<T, R>(work: (input: T, signal: AbortSignal) => Promise<R>) {
  type Job = { input: T; signal: AbortSignal; priority: boolean; resolve: (value: R) => void; reject: (reason: unknown) => void; cleanup: () => void };
  let active: { job: Job; controller: AbortController } | undefined;
  let pending: Job | undefined;
  function start(job: Job) {
    const controller = new AbortController();
    active = { job, controller };
    const abort = () => controller.abort(job.signal.reason);
    job.signal.addEventListener('abort', abort, { once: true });
    if (job.signal.aborted) abort();
    void work(job.input, controller.signal).then(job.resolve, job.reject).finally(() => {
      job.signal.removeEventListener('abort', abort); job.cleanup(); active = undefined;
      const next = pending; pending = undefined;
      if (next) start(next);
    });
  }
  return {
    submit(input: T, signal: AbortSignal, priority = false): Promise<R> {
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const job: Job = { input, signal, priority, resolve, reject, cleanup: () => {} };
        if (!active) { start(job); return; }
        if (!priority && (active.job.priority || pending?.priority)) { reject(new Error('Operator input has priority')); return; }
        if (pending) { pending.cleanup(); pending.reject(new Error('Superseded by newer input')); }
        pending = job;
        const abort = () => { if (pending === job) { pending = undefined; job.cleanup(); reject(signal.reason); } };
        signal.addEventListener('abort', abort, { once: true });
        job.cleanup = () => signal.removeEventListener('abort', abort);
        if (priority) active.controller.abort(new Error('Superseded by operator input'));
      });
    },
    cancel(reason: unknown = new Error('Intelligence invalidated')) {
      active?.controller.abort(reason);
      if (pending) { pending.cleanup(); pending.reject(reason); pending = undefined; }
    },
  };
}
