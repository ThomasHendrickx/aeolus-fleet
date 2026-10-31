import type { DataKeyId, FleetId, MessageId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { DataKey, SealedRow } from '../../domain/messaging/payload-sealer.js';
import { aesGcmPayloadSealer } from './payload-sealer.js';

const PAYLOAD_LIMIT_BYTES = 256 * 1024;

function aDataKey(id: DataKeyId, fill: number): DataKey {
  return { id, material: new Uint8Array(32).fill(fill) };
}

const KEY = aDataKey('dky_01m62dg2f1v5nndyp9ft549m98', 7);
const FLEET: FleetId = 'flt_01m62dg2f1v5nndyp9ft549m90';
const MESSAGE: MessageId = 'msg_01m62dg2f1v5nndyp9ft549m91';
const ROW: SealedRow = { fleetId: FLEET, rowId: MESSAGE };

describe('aesGcmPayloadSealer (decision 0068, B7)', () => {
  it('opens a payload it sealed, exactly as sent', () => {
    const payload = 'Ship the release notes: ü, 漢字 and 🚢.';

    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, payload);

    expect(sealed.dataKeyId).toBe(KEY.id);
    expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain('release notes');
    expect(aesGcmPayloadSealer.unseal({ key: KEY, row: ROW }, sealed)).toEqual({ isOk: true, value: payload });
  });

  it('seals and opens a 256 KB payload', () => {
    const payload = 'x'.repeat(PAYLOAD_LIMIT_BYTES);

    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, payload);

    expect(aesGcmPayloadSealer.unseal({ key: KEY, row: ROW }, sealed)).toEqual({ isOk: true, value: payload });
  });

  it('seals with a fresh 96-bit nonce each time, so one payload never seals the same twice', () => {
    const first = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'same');
    const second = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'same');

    expect(first.nonce).toHaveLength(12);
    expect(second.nonce).not.toEqual(first.nonce);
    expect(second.ciphertext).not.toEqual(first.ciphertext);
  });

  it("does not open a sealed payload copied into another message's row (scenario 17)", () => {
    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'for one message only');

    const opened = aesGcmPayloadSealer.unseal({ key: KEY, row: { fleetId: FLEET, rowId: 'msg_01m62dg2f1v5nndyp9ft549m92' } }, sealed);

    expect(opened).toEqual({ isOk: false, error: { kind: 'sealNotOpened' } });
  });

  it('does not open a sealed payload moved to another fleet', () => {
    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'for one fleet only');

    const opened = aesGcmPayloadSealer.unseal({ key: KEY, row: { fleetId: 'flt_01m62dg2f1v5nndyp9ft549m93', rowId: MESSAGE } }, sealed);

    expect(opened).toEqual({ isOk: false, error: { kind: 'sealNotOpened' } });
  });

  it('does not open a sealed payload under another data key', () => {
    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'for one key only');

    const opened = aesGcmPayloadSealer.unseal({ key: aDataKey(KEY.id, 8), row: ROW }, sealed);

    expect(opened).toEqual({ isOk: false, error: { kind: 'sealNotOpened' } });
  });

  it('does not open a sealed payload whose ciphertext was changed', () => {
    const sealed = aesGcmPayloadSealer.seal({ key: KEY, row: ROW }, 'untouched');
    const ciphertext = new Uint8Array(sealed.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

    const opened = aesGcmPayloadSealer.unseal({ key: KEY, row: ROW }, { ...sealed, ciphertext });

    expect(opened).toEqual({ isOk: false, error: { kind: 'sealNotOpened' } });
  });
});

describe('aesGcmPayloadSealer check value (decision 0068, B6)', () => {
  it('is HMAC-SHA-256 of the fixed text "aeolus/v1 check value" under the data key', () => {
    // printf 'aeolus/v1 check value' | openssl dgst -sha256 -mac HMAC -macopt hexkey:<64 zeros>
    const expected = 'a9054361f2eb878aa0d230dcd49e124c0ade7b972432d998edc45daf2c2aaf35';

    const checkValue = aesGcmPayloadSealer.checkValue(new Uint8Array(32));

    expect(Buffer.from(checkValue).toString('hex')).toBe(expected);
  });

  it('tells two data keys apart', () => {
    expect(aesGcmPayloadSealer.checkValue(aDataKey(KEY.id, 1).material)).not.toEqual(
      aesGcmPayloadSealer.checkValue(aDataKey(KEY.id, 2).material),
    );
  });
});
