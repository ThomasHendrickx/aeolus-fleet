/**
 * The waits from send to acknowledgement kept as a count per duration bucket
 * (performance design, decision 10), so an hour of the stuck snapshot holds a
 * fixed size and the median of 24 hours is read from their summed buckets.
 * The buckets are log-spaced, 128 to a doubling: under half a percent wide,
 * finer than the console rounds the median.
 */

/** How many buckets each doubling of the wait is split into. */
const BUCKETS_PER_DOUBLING = 128;

/** The count of waits in each bucket, by its number; bucket 0 holds the waits of no time. */
export type WaitBuckets = ReadonlyMap<number, number>;

function bucketOf(waitMs: number): number {
  return waitMs < 1 ? 0 : Math.floor(Math.log2(waitMs) * BUCKETS_PER_DOUBLING) + 1;
}

/** The middle of a bucket, as its waits are read back. */
function waitOf(bucket: number): number {
  return bucket === 0 ? 0 : 2 ** ((bucket - 0.5) / BUCKETS_PER_DOUBLING);
}

/** The buckets of the given waits, in milliseconds. */
export function waitsOf(waitsMs: readonly number[]): WaitBuckets {
  const buckets = new Map<number, number>();
  for (const waitMs of waitsMs) {
    const bucket = bucketOf(waitMs);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return buckets;
}

/** The buckets of several hours summed. */
export function sumOfWaits(hours: readonly WaitBuckets[]): WaitBuckets {
  const sum = new Map<number, number>();
  for (const [bucket, count] of hours.flatMap((hour) => [...hour])) {
    sum.set(bucket, (sum.get(bucket) ?? 0) + count);
  }
  return sum;
}

/** The middle wait, or the mean of the two middle ones, of the buckets of several hours summed; none of none. */
export function medianOfWaits(hours: readonly WaitBuckets[]): number | null {
  const buckets = [...sumOfWaits(hours)].toSorted(([first], [second]) => first - second);
  const count = buckets.reduce((sum, [, inBucket]) => sum + inBucket, 0);
  if (count === 0) {
    return null;
  }
  const waitAt = (rank: number): number => {
    let passed = 0;
    for (const [bucket, inBucket] of buckets) {
      passed += inBucket;
      if (rank < passed) {
        return waitOf(bucket);
      }
    }
    return 0;
  };
  const upper = waitAt(Math.floor(count / 2));
  return count % 2 === 1 ? upper : (waitAt(count / 2 - 1) + upper) / 2;
}
