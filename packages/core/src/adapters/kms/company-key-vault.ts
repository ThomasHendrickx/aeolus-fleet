/**
 * The company's own AWS KMS, as the recovery command reaches it on the
 * company's computer (decision 0068, B15): with the AWS SDK's own credential
 * chain there (a profile, SSO or the environment), never the installation's
 * principal, and in the region the key's ARN names, else `AWS_REGION`.
 * Nothing of it is sent to Aeolus.
 */
import type { KeyVault } from '../../domain/messaging/key-vault.js';
import { createAwsKmsKeyVault } from './aws-kms-key-vault.js';

/** `arn:<partition>:kms:<region>:<account>:key/...` or `.../alias/...`. */
const KMS_ARN = /^arn:[a-z-]+:kms:([a-z0-9-]+):/;

/** Recovery wraps a handful of data keys once: it may wait on the KMS longer than a send does. */
const RECOVERY_REQUEST_TIMEOUT_MS = 30_000;

export function companyKeyVaultFor(companyKey: string, environment: Readonly<Record<string, string | undefined>>): KeyVault {
  const region = KMS_ARN.exec(companyKey)?.[1] ?? environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION;
  if (region === undefined) {
    // A system failure at the terminal: the command cannot reach any KMS.
    throw new Error(`Name the new company key by its ARN, or set AWS_REGION: ${companyKey} names no region`);
  }
  return createAwsKmsKeyVault({ region, requestTimeoutMs: RECOVERY_REQUEST_TIMEOUT_MS });
}
