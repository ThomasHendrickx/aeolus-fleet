import { createServer } from 'node:net';

import { CreateKeyCommand, DisableKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAwsKmsKeyVault } from '../src/adapters/kms/aws-kms-key-vault.js';
import type { CompanyKeyReference } from '../src/domain/messaging/key-vault.js';
import { describeKeyVault, type KeyVaultWorld } from './support/key-vault-contract.js';
import { startKmsKeyPolicy, type KmsKeyPolicy } from './support/kms-key-policy.js';
import { startLocalStack, type StartedLocalStack } from './support/localstack.js';

const REGION = 'eu-west-1';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const MISSING_KEY = 'arn:aws:kms:eu-west-1:000000000000:key/00000000-0000-0000-0000-000000000000';
const FLEET = 'flt_01m62dg2f1v5nndyp9ft549m90';
const SHORT_TIMEOUT_MS = 500;

let localStack: StartedLocalStack;
let policy: KmsKeyPolicy;
let company: KMSClient;

beforeAll(async () => {
  localStack = await startLocalStack();
  policy = await startKmsKeyPolicy(localStack.kmsEndpoint);
  company = new KMSClient({ endpoint: localStack.kmsEndpoint, region: REGION, credentials: CREDENTIALS });
});

afterAll(async () => {
  company.destroy();
  await policy.close();
  await localStack.stop();
});

async function aCompanyKey(): Promise<CompanyKeyReference> {
  const created = await company.send(new CreateKeyCommand({ Description: 'a company key' }));
  const arn = created.KeyMetadata?.Arn;
  if (arn === undefined) {
    throw new Error('LocalStack made a key without an ARN.');
  }
  return arn;
}

function aWorld(): KeyVaultWorld {
  return {
    vault: createAwsKmsKeyVault({ region: REGION, endpoint: policy.endpoint, credentials: CREDENTIALS }),
    aCompanyKey,
    disable: async (companyKey) => {
      await company.send(new DisableKeyCommand({ KeyId: companyKey }));
    },
    refuseGrant: (companyKey) => {
      policy.refuseGrant(companyKey);
      return Promise.resolve();
    },
    bindToFleet: (companyKey, fleetId) => {
      policy.bindToFleet(companyKey, fleetId);
      return Promise.resolve();
    },
    missingKey: MISSING_KEY,
  };
}

describeKeyVault('the AWS KMS key vault on LocalStack', aWorld);

/** A local port nothing listens on. */
async function aClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  if (address === null || typeof address === 'string') {
    throw new Error('The probe listened on no TCP port.');
  }
  return address.port;
}

describe('the AWS KMS key vault when the KMS does not answer (decision 0068, B4)', () => {
  it('answers unreachable when nothing answers at its endpoint', async () => {
    const port = await aClosedPort();
    const vault = createAwsKmsKeyVault({ region: REGION, endpoint: `http://127.0.0.1:${String(port)}`, credentials: CREDENTIALS });

    const made = await vault.makeDataKey({ fleetId: FLEET, companyKey: await aCompanyKey() });

    expect(made).toEqual({ isOk: false, error: { kind: 'keyUnavailable', reason: 'unreachable' } });
  });

  it('answers unreachable when the KMS does not answer in time', async () => {
    const companyKey = await aCompanyKey();
    policy.holdCalls(companyKey);
    const vault = createAwsKmsKeyVault({ region: REGION, endpoint: policy.endpoint, credentials: CREDENTIALS, requestTimeoutMs: SHORT_TIMEOUT_MS });

    const made = await vault.makeDataKey({ fleetId: FLEET, companyKey });

    expect(made).toEqual({ isOk: false, error: { kind: 'keyUnavailable', reason: 'unreachable' } });
  });
});
