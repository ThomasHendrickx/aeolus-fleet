/**
 * A company's key vault in memory, for the use case tests (decision 0068):
 * its company keys, each enabled or disabled and granted to the installation
 * or not. A wrap names its company key, its fleet and its data key in plain
 * text: nothing here keeps a secret, it only keeps the vault's rules.
 */
import { randomBytes } from 'node:crypto';

import type { FleetId } from '@aeolus-fleet/common';

import type { CompanyKeyReference, CompanyKeyUse, KeyUnavailable, KeyUnavailableReason, KeyVault, WrappedDataKey } from '../../src/domain/messaging/key-vault.js';
import { err, ok, type Result } from '../../src/domain/shared/result.js';
import type { KeyVaultWorld } from './key-vault-contract.js';

const DATA_KEY_BYTES = 32;
const SEPARATOR = '|';

interface CompanyKey {
  isEnabled: boolean;
  isGranted: boolean;
}

interface Wrap {
  companyKey: CompanyKeyReference;
  fleetId: string;
  materialHex: string;
}

function refused(reason: KeyUnavailableReason): Result<never, KeyUnavailable> {
  return err({ kind: 'keyUnavailable', reason });
}

function wrapOf(companyKey: CompanyKeyReference, fleetId: FleetId, material: Uint8Array): WrappedDataKey {
  return new Uint8Array(Buffer.from([companyKey, fleetId, Buffer.from(material).toString('hex')].join(SEPARATOR), 'utf8'));
}

function readWrap(wrapped: WrappedDataKey): Wrap | undefined {
  const [companyKey, fleetId, materialHex] = Buffer.from(wrapped).toString('utf8').split(SEPARATOR);
  return companyKey === undefined || fleetId === undefined || materialHex === undefined ? undefined : { companyKey, fleetId, materialHex };
}

export function createInMemoryKeyVault(): KeyVaultWorld {
  const keys = new Map<CompanyKeyReference, CompanyKey>();
  let made = 0;

  const usable = (companyKey: CompanyKeyReference): KeyUnavailableReason | undefined => {
    const key = keys.get(companyKey);
    if (key === undefined) {
      return 'notFound';
    }
    if (!key.isGranted) {
      return 'accessDenied';
    }
    return key.isEnabled ? undefined : 'disabled';
  };

  const open = (use: CompanyKeyUse, wrapped: WrappedDataKey): Result<Uint8Array<ArrayBuffer>, KeyUnavailable> => {
    const reason = usable(use.companyKey);
    if (reason !== undefined) {
      return refused(reason);
    }
    const wrap = readWrap(wrapped);
    if (wrap?.companyKey !== use.companyKey || wrap.fleetId !== use.fleetId) {
      return refused('invalidWrap');
    }
    return ok(new Uint8Array(Buffer.from(wrap.materialHex, 'hex')));
  };

  const wrapWith = (use: CompanyKeyUse, material: Uint8Array): Result<WrappedDataKey, KeyUnavailable> => {
    const reason = usable(use.companyKey);
    return reason === undefined ? ok(wrapOf(use.companyKey, use.fleetId, material)) : refused(reason);
  };

  const vault: KeyVault = {
    makeDataKey: (use) => {
      const material = new Uint8Array(randomBytes(DATA_KEY_BYTES));
      const wrapped = wrapWith(use, material);
      return Promise.resolve(wrapped.isOk ? ok({ material, wrapped: wrapped.value }) : wrapped);
    },
    unwrap: (use, wrapped) => Promise.resolve(open(use, wrapped)),
    wrap: (use, material) => Promise.resolve(wrapWith(use, material)),
    rewrap: (change, wrapped) => {
      const reason = usable(change.to);
      const opened = open({ fleetId: change.fleetId, companyKey: change.from }, wrapped);
      if (!opened.isOk) {
        return Promise.resolve(opened);
      }
      return Promise.resolve(reason === undefined ? ok(wrapOf(change.to, change.fleetId, opened.value)) : refused(reason));
    },
  };

  const change = (companyKey: CompanyKeyReference, to: Partial<CompanyKey>): void => {
    const key = keys.get(companyKey);
    if (key !== undefined) {
      keys.set(companyKey, { ...key, ...to });
    }
  };

  return {
    vault,
    missingKey: 'arn:aws:kms:eu-west-1:000000000000:key/missing',
    aCompanyKey: () => {
      made += 1;
      const companyKey = `arn:aws:kms:eu-west-1:000000000000:key/in-memory-${String(made)}`;
      keys.set(companyKey, { isEnabled: true, isGranted: true });
      return Promise.resolve(companyKey);
    },
    disable: (companyKey) => {
      change(companyKey, { isEnabled: false });
      return Promise.resolve();
    },
    refuseGrant: (companyKey) => {
      change(companyKey, { isGranted: false });
      return Promise.resolve();
    },
  };
}
