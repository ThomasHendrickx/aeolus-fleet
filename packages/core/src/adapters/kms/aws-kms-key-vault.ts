/**
 * The key vault on AWS KMS (decision 0068, B2): `GenerateDataKey`, `Decrypt`,
 * `Encrypt` and `ReEncrypt`, each with the encryption context
 * `aeolus:fleet = <fleet id>`, as the installation's one KMS principal. The
 * principal's credentials come from the AWS SDK's own chain (environment,
 * shared files or the role the server runs as) unless given. The KMS's
 * refusals and silences are answers, never thrown: each becomes
 * `keyUnavailable` with its reason.
 */
import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
  KMSServiceException,
  ReEncryptCommand,
} from '@aws-sdk/client-kms';
import type { FleetId } from '@aeolus-fleet/common';

import type { KeyUnavailable, KeyUnavailableReason, KeyVault } from '../../domain/messaging/key-vault.js';
import { err, ok, type Result } from '../../domain/shared/result.js';

/** How long a call to the KMS may take before it counts as unreachable. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/** One try: a caller refused `KEY_UNAVAILABLE` tries again itself, and a send must not wait out the SDK's retries. */
const MAX_ATTEMPTS = 1;
const DATA_KEY_SPEC = 'AES_256';
const FLEET_CONTEXT_KEY = 'aeolus:fleet';

export interface AwsKmsSettings {
  readonly region: string;
  /** Another KMS endpoint than AWS's own for the region, such as LocalStack's. */
  readonly endpoint?: string | undefined;
  /** The installation principal's credentials. Unset: the AWS SDK's own chain. */
  readonly credentials?: { readonly accessKeyId: string; readonly secretAccessKey: string } | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

/** The KMS's error names, by the reason each gives. */
const REASON_BY_ERROR: Readonly<Record<string, KeyUnavailableReason>> = {
  AccessDeniedException: 'accessDenied',
  DisabledException: 'disabled',
  KMSInvalidStateException: 'disabled',
  NotFoundException: 'notFound',
  InvalidCiphertextException: 'invalidWrap',
  IncorrectKeyException: 'invalidWrap',
  DependencyTimeoutException: 'unreachable',
  KMSInternalException: 'unreachable',
  ThrottlingException: 'unreachable',
};

function contextOf(fleetId: FleetId): Record<string, string> {
  return { [FLEET_CONTEXT_KEY]: fleetId };
}

/**
 * The reason a failed call gives. A KMS error it does not know is a system
 * failure and is thrown on; anything that is not a KMS answer at all (a
 * refused connection, a timeout) means the KMS did not answer.
 */
function reasonOf(error: unknown): KeyUnavailableReason {
  if (error instanceof KMSServiceException) {
    const reason = REASON_BY_ERROR[error.name];
    if (reason === undefined) {
      throw error;
    }
    return reason;
  }
  return 'unreachable';
}

async function answerOf<T>(call: () => Promise<T>): Promise<Result<T, KeyUnavailable>> {
  try {
    return ok(await call());
  } catch (error) {
    return err({ kind: 'keyUnavailable', reason: reasonOf(error) });
  }
}

function bytesOf(value: Uint8Array | undefined): Uint8Array<ArrayBuffer> {
  if (value === undefined) {
    throw new Error('AWS KMS answered without the key bytes it owes.');
  }
  return new Uint8Array(value);
}

export function createAwsKmsKeyVault(settings: AwsKmsSettings): KeyVault {
  const requestTimeoutMs = settings.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const kms = new KMSClient({
    region: settings.region,
    endpoint: settings.endpoint,
    credentials: settings.credentials,
    maxAttempts: MAX_ATTEMPTS,
  });
  /** Each call whole, connection to answer, within the timeout. */
  const inTime = () => ({ abortSignal: AbortSignal.timeout(requestTimeoutMs) });

  return {
    makeDataKey: (use) =>
      answerOf(async () => {
        const made = await kms.send(
          new GenerateDataKeyCommand({ KeyId: use.companyKey, KeySpec: DATA_KEY_SPEC, EncryptionContext: contextOf(use.fleetId) }),
          inTime(),
        );
        return { material: bytesOf(made.Plaintext), wrapped: bytesOf(made.CiphertextBlob) };
      }),

    unwrap: (use, wrapped) =>
      answerOf(async () => {
        const opened = await kms.send(
          new DecryptCommand({ KeyId: use.companyKey, CiphertextBlob: wrapped, EncryptionContext: contextOf(use.fleetId) }),
          inTime(),
        );
        return bytesOf(opened.Plaintext);
      }),

    wrap: (use, material) =>
      answerOf(async () => {
        const wrapped = await kms.send(
          new EncryptCommand({ KeyId: use.companyKey, Plaintext: material, EncryptionContext: contextOf(use.fleetId) }),
          inTime(),
        );
        return bytesOf(wrapped.CiphertextBlob);
      }),

    rewrap: (change, wrapped) =>
      answerOf(async () => {
        const context = contextOf(change.fleetId);
        const rewrapped = await kms.send(
          new ReEncryptCommand({
            CiphertextBlob: wrapped,
            SourceKeyId: change.from,
            SourceEncryptionContext: context,
            DestinationKeyId: change.to,
            DestinationEncryptionContext: context,
          }),
          inTime(),
        );
        return bytesOf(rewrapped.CiphertextBlob);
      }),
  };
}
