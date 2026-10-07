import type { Result } from '../../src/domain/shared/result.js';

/** The value of an ok result. Fails the test with the domain's refusal otherwise. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.isOk) {
    throw new Error(`Expected an ok result, but the domain refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** The refusal of an error result. Fails the test with the value otherwise. */
export function refusalOf<T, E>(result: Result<T, E>): E {
  if (result.isOk) {
    throw new Error(`Expected a refusal, but the domain answered: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}
