import { parseArgs } from 'node:util';

import { recoverKeysOutputSchema, recoverySetOutputSchema } from '@aeolus-fleet/common';

import type { KeyVault } from '../../domain/messaging/key-vault.js';
import { aesGcmPayloadSealer } from '../crypto/payload-sealer.js';
import { recoveryIdentityOf } from '../crypto/age-recovery-identity.js';
import { createFleetApi, fleetApiCredentialsOf } from './fleet-api.js';
import type { CommandIo, ExitCode } from './io.js';

const USAGE = 'Usage: aeolus-core fleet:recover-keys --identity <age identity file> --company-key <new company key ARN>';

/**
 * `fleet:recover-keys`: recovers a sealed fleet's data keys under a new
 * company key when the old one is lost (decision 0068, B15), run on the
 * company's own computer, never on the server. It reads the fleet's recovery
 * set, opens each data key with the offline recovery key's private half (an
 * age identity file), checks it against its check value, wraps it under the
 * new company key in the company's own KMS for this fleet, with the
 * company's own AWS credentials, and uploads the wraps. No private key, data
 * key or company credential leaves this computer, nor is any printed. Nothing
 * is uploaded unless every data key opened right; the fleet changes nothing
 * unless every wrap opens there too.
 */
export async function fleetRecoverKeys(
  args: string[],
  deps: {
    environment: Readonly<Record<string, string | undefined>>;
    fetch: typeof fetch;
    readFile: (path: string) => Promise<string>;
    /** The company's own KMS, for the new company key, as its credentials on this computer reach it. */
    vaultFor: (companyKey: string) => KeyVault;
    io: CommandIo;
  },
): Promise<ExitCode> {
  const { io } = deps;

  let identityFile: string | undefined;
  let companyKey: string | undefined;
  try {
    const { values } = parseArgs({ args, options: { identity: { type: 'string' }, 'company-key': { type: 'string' } }, strict: true });
    identityFile = values.identity;
    companyKey = values['company-key'];
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (identityFile === undefined || companyKey === undefined) {
    io.err(USAGE);
    return 2;
  }
  const credentials = fleetApiCredentialsOf(deps.environment);
  if (!credentials.isOk) {
    io.err(credentials.error);
    return 2;
  }

  const identity = await recoveryIdentityOf(await deps.readFile(identityFile));
  if (identity === undefined) {
    io.err(`${identityFile} holds no single age X25519 identity (a line starting AGE-SECRET-KEY-1). Nothing changed.`);
    return 1;
  }
  const api = createFleetApi({ ...credentials.value, fetch: deps.fetch });
  const set = await api.query('fleet.recoverySet', recoverySetOutputSchema);
  if (!set.isOk) {
    io.err(set.error.message);
    return 1;
  }
  const { fleetId, recoveryKeyFingerprint } = set.value;
  if (identity.fingerprint !== recoveryKeyFingerprint) {
    io.err(`${identityFile} is not this fleet's recovery key: the fleet's is ${recoveryKeyFingerprint}, this one is ${identity.fingerprint}. Nothing changed.`);
    return 1;
  }

  const vault = deps.vaultFor(companyKey);
  const dataKeys: { id: string; wrappedByCompanyKey: string }[] = [];
  for (const { id, wrappedByRecoveryKey, checkValue } of set.value.dataKeys) {
    const material = await identity.open(new Uint8Array(Buffer.from(wrappedByRecoveryKey, 'base64')));
    if (material === undefined || !Buffer.from(aesGcmPayloadSealer.checkValue(material)).equals(Buffer.from(checkValue, 'base64'))) {
      io.err(`Data key ${id} does not open to the key its check value names. Nothing changed.`);
      return 1;
    }
    const wrapped = await vault.wrap({ fleetId, companyKey }, material);
    material.fill(0);
    if (!wrapped.isOk) {
      io.err(`Your KMS did not wrap data key ${id} under ${companyKey}: ${wrapped.error.reason}. Check its key policy and your AWS credentials. Nothing changed.`);
      return 1;
    }
    dataKeys.push({ id, wrappedByCompanyKey: Buffer.from(wrapped.value).toString('base64') });
  }

  const recovered = await api.mutation('fleet.recoverKeys', { input: { companyKey, dataKeys }, output: recoverKeysOutputSchema });
  if (!recovered.isOk) {
    io.err(recovered.error.message);
    return 1;
  }
  io.out(`Recovered ${String(dataKeys.length)} data keys of fleet ${fleetId} under ${recovered.value.companyKey}. Every sealed payload opens again.`);
  return 0;
}
