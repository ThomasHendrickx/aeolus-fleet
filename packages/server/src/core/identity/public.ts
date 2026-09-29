// Identity's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export {
  issueShipSecret,
  revokeShipSecret,
  SHIP_SECRET_PREFIX,
  type Credential,
  type CredentialTx,
  type SecretTools,
} from './credential.js';
export { operatorEmail, operatorPassword } from './operator-account.js';
export type { CredentialRepository, OperatorAccountRepository } from './ports.js';
