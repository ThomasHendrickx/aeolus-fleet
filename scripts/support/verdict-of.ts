import { BUDGET } from './budget.ts';
import type { Measurement } from './measurement.ts';

/** Which limits of the budget a read reaches or passes: a read within it is under all three. */
export function verdictOf(measured: Measurement): { isWithin: boolean; over: ('p95' | 'p99' | 'errors')[] } {
  const over: ('p95' | 'p99' | 'errors')[] = [];
  if (measured.p95Ms >= BUDGET.p95Ms) {
    over.push('p95');
  }
  if (measured.p99Ms >= BUDGET.p99Ms) {
    over.push('p99');
  }
  if (measured.errorRate >= BUDGET.errorRate) {
    over.push('errors');
  }
  return { isWithin: over.length === 0, over };
}
