import type { Result } from '../../src/core/shared/result.js';

/** The value of an ok result. Fails the test with the domain's refusal otherwise. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.isOk) {
    throw new Error(`Expected an ok result, but the domain refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
