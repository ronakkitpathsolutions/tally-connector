import { runExclusive, queueDepth, resetQueue } from './tallyQueue';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => resetQueue());

describe('runExclusive', () => {
  it('never lets two tasks overlap', async () => {
    // The whole point: Tally handles one request at a time, so two pushes arriving together must
    // not interleave on it.
    let running = 0;
    let maxConcurrent = 0;

    const task = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await wait(20);
      running -= 1;
    };

    await Promise.all([runExclusive(task), runExclusive(task), runExclusive(task)]);
    expect(maxConcurrent).toBe(1);
  });

  it('runs them in the order they were queued', async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        runExclusive(async () => {
          await wait(n === 1 ? 30 : 1); // the first is slowest; FIFO must still hold
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('keeps going after a task throws', async () => {
    // A failed push must not wedge the queue for everything behind it.
    const failing = runExclusive(async () => {
      throw new Error('tally said no');
    });
    await expect(failing).rejects.toThrow('tally said no');

    await expect(runExclusive(async () => 'next one ran')).resolves.toBe('next one ran');
  });

  it('passes the task result back to its own caller', async () => {
    const [a, b] = await Promise.all([runExclusive(async () => 'a'), runExclusive(async () => 'b')]);
    expect([a, b]).toEqual(['a', 'b']);
  });

  it('reports how many calls are waiting', async () => {
    expect(queueDepth()).toBe(0);
    const running = [runExclusive(() => wait(20)), runExclusive(() => wait(20))];
    expect(queueDepth()).toBe(2);
    await Promise.all(running);
    expect(queueDepth()).toBe(0);
  });
});
