/**
 * Why the domain refused a request. Adapters map a code to their own error
 * shape (a tRPC code, an exit code); the message is safe to show a caller.
 */
export type DomainErrorCode =
  | 'FLEET_ALREADY_EXISTS'
  | 'FLEET_NOT_FOUND'
  | 'INVALID_FLEET_NAME'
  | 'INVALID_LOCATION'
  | 'INVALID_SECRET'
  | 'NOT_THE_OPERATOR_SHIP'
  | 'OPERATOR_SHIP_IS_PERMANENT'
  | 'SHIP_NAME_RESERVED';

export class DomainError extends Error {
  override name = 'DomainError';

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}
