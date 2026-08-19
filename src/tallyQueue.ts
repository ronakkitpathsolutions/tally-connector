/**
 * Serialises every call to Tally, process-wide.
 *
 * TallyPrime's XML listener handles one request at a time. Two arriving together do not run in
 * parallel — one blocks, and under load Tally stops answering altogether. A single push already
 * costs several requests (dedup lookup, ledger lookup, master creation, the import), so two
 * overlapping pushes are enough to interleave and stall it.
 *
 * The backend drains its own queue one invoice at a time, but that is the wrong place to rely on:
 * it does not cover a second backend instance, a retry firing while a push is in flight, /health
 * polling, or anyone calling the connector directly. Serialising here means Tally sees exactly one
 * request at a time no matter who asked.
 */

let chain: Promise<unknown> = Promise.resolve();
let depth = 0;

/** Number of calls waiting or running. Exposed for /health so contention is visible. */
export function queueDepth(): number {
  return depth;
}

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  depth += 1;

  // Chained off the settled state, not the value: one failed call must not stop the queue, and a
  // rejection here would otherwise become an unhandled rejection on the shared chain.
  const result = chain.then(task, task);
  chain = result.then(
    () => undefined,
    () => undefined,
  );

  return result.finally(() => {
    depth -= 1;
  });
}

/** Test-only: drops any queued work so one spec cannot bleed into the next. */
export function resetQueue(): void {
  chain = Promise.resolve();
  depth = 0;
}
