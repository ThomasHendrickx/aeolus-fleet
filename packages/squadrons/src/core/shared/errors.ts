import { err, type Err } from './result.js';

/** Every reason squadrons' core refuses a request. */
export type DomainErrorKind =
  | 'MANAGEMENT_SECRET_MISSING'
  | 'MANAGEMENT_SECRET_REFUSED'
  | 'MANAGEMENT_SHIP_CREWED_ELSEWHERE'
  | 'NOT_THE_OPERATOR'
  | 'BLUEPRINT_NOT_FOUND'
  | 'INVALID_SQUADRON_ID'
  | 'SQUADRON_ID_TAKEN'
  | 'MANAGEMENT_SHIP_NOT_CREWED'
  | 'FORMING_FAILED';

/** Why the core refused a request. Adapters map the kind to their own error shape; the message is safe to show. */
export interface DomainError<K extends DomainErrorKind = DomainErrorKind> {
  readonly kind: K;
  readonly message: string;
}

/** A refusal: the error result of the given kind. */
export function refuse<K extends DomainErrorKind>(kind: K, message: string): Err<DomainError<K>> {
  return err({ kind, message });
}
