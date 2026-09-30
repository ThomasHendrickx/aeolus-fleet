import { err, type Err } from './result.js';

/** Every reason the domain refuses a request. */
export type DomainErrorKind =
  | 'DELIVERY_HELD_BY_ANOTHER_SHIP'
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_NOT_IN_FLIGHT'
  | 'FLEET_ALREADY_EXISTS'
  | 'FLEET_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IN_REPLY_TO_NOT_FOUND'
  | 'INVALID_CONTENT_TYPE'
  | 'INVALID_EMAIL'
  | 'INVALID_FLEET_NAME'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'INVALID_LOCATION'
  | 'INVALID_PASSWORD'
  | 'INVALID_RECEIVE_MAX'
  | 'INVALID_SHIP_NAME'
  | 'INVALID_SHIP_NOTE'
  | 'INVALID_SHIP_TYPE'
  | 'LEASE_ENDED'
  | 'NOT_THE_OPERATOR_SHIP'
  | 'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT'
  | 'OPERATOR_SHIP_HAS_NO_SECRET'
  | 'OPERATOR_SHIP_IS_PERMANENT'
  | 'PAYLOAD_TOO_LARGE'
  | 'SHIP_NAME_RESERVED'
  | 'SHIP_NAME_TAKEN'
  | 'SHIP_NOT_AWAITING_CREW'
  | 'SHIP_NOT_CREWED'
  | 'SHIP_NOT_FOUND'
  | 'UNRESOLVABLE_SELECTOR'
  | 'WRONG_EMAIL_OR_PASSWORD'
  | 'WRONG_SHIP_ID_OR_SECRET';

/**
 * Why the domain refused a request. Adapters map the kind to their own error
 * shape (a tRPC code, an exit code); the message is safe to show a caller.
 */
export interface DomainError<K extends DomainErrorKind = DomainErrorKind> {
  readonly kind: K;
  readonly message: string;
}

/** A refusal: the error result of the given kind. */
export function refuse<K extends DomainErrorKind>(kind: K, message: string): Err<DomainError<K>> {
  return err({ kind, message });
}
