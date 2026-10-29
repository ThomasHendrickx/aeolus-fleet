/**
 * Seals payloads with AES-256-GCM (decision 0068, B7): a random 96-bit nonce
 * per seal, and additional data naming the version, the fleet and the row, so
 * GCM refuses a sealed payload moved to another row or fleet.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import type { DataKeyMaterial } from '../../domain/messaging/key-vault.js';
import type { PayloadSealer, SealedRow } from '../../domain/messaging/payload-sealer.js';
import { err, ok } from '../../domain/shared/result.js';

const CIPHER = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'aeolus/v1';
/** The fixed text the check value signs: it proves a key without revealing it. */
const CHECK_TEXT = `${VERSION} check value`;

/** Ids never hold a NUL, so the parts cannot run into each other. */
function additionalDataOf(row: SealedRow): Buffer {
  return Buffer.from([VERSION, row.fleetId, row.rowId].join('\0'), 'utf8');
}

function bytesOf(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

export const aesGcmPayloadSealer: PayloadSealer = {
  seal: ({ key, row }, payload) => {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(CIPHER, key.material, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalDataOf(row));
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { dataKeyId: key.id, nonce: bytesOf(nonce), ciphertext: bytesOf(ciphertext) };
  },

  unseal: ({ key, row }, sealed) => {
    const tagStart = sealed.ciphertext.length - TAG_BYTES;
    if (tagStart < 0 || sealed.nonce.length !== NONCE_BYTES) {
      return err({ kind: 'sealNotOpened' });
    }
    const decipher = createDecipheriv(CIPHER, key.material, sealed.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalDataOf(row));
    decipher.setAuthTag(sealed.ciphertext.subarray(tagStart));
    try {
      const plain = Buffer.concat([decipher.update(sealed.ciphertext.subarray(0, tagStart)), decipher.final()]);
      return ok(plain.toString('utf8'));
    } catch {
      // GCM's final() throws when the tag does not match: another key, another row or fleet, or damaged.
      return err({ kind: 'sealNotOpened' });
    }
  },

  checkValue: (material: DataKeyMaterial) => bytesOf(createHmac('sha256', material).update(CHECK_TEXT, 'utf8').digest()),
};
