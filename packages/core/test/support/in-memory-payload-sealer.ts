/**
 * A payload sealer in memory, for the use case tests (decision 0068): a
 * sealed payload names its data key, fleet and row and holds the payload in
 * plain text. Nothing here keeps a secret; it keeps the sealer's rules, so a
 * sealed payload opens only for its key, fleet and row.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { PayloadSealer } from '../../src/domain/messaging/payload-sealer.js';
import { err, ok } from '../../src/domain/shared/result.js';

const NONCE_BYTES = 12;
const SEPARATOR = '\0';

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

function fingerprintOf(material: Uint8Array): string {
  return createHash('sha256').update(material).digest('hex');
}

export const inMemoryPayloadSealer: PayloadSealer = {
  seal: ({ key, row }, payload) => ({
    dataKeyId: key.id,
    nonce: new Uint8Array(randomBytes(NONCE_BYTES)),
    ciphertext: bytesOf([fingerprintOf(key.material), row.fleetId, row.rowId, payload].join(SEPARATOR)),
  }),
  unseal: ({ key, row }, sealed) => {
    const [fingerprint, fleetId, rowId, ...payload] = Buffer.from(sealed.ciphertext).toString('utf8').split(SEPARATOR);
    return fingerprint === fingerprintOf(key.material) && fleetId === row.fleetId && rowId === row.rowId && sealed.dataKeyId === key.id
      ? ok(payload.join(SEPARATOR))
      : err({ kind: 'sealNotOpened' });
  },
  checkValue: (material) => bytesOf(fingerprintOf(material)),
};
