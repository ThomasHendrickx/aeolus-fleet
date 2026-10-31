/**
 * What every KeyVault adapter does (decision 0068, B2), run against the AWS
 * KMS adapter on LocalStack and against the in-memory vault the use case
 * tests take, so the fake keeps to the real one.
 */
import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CompanyKeyReference, KeyVault } from '../../src/domain/messaging/key-vault.js';
import { unwrap } from '../../src/testing/result.js';

/** A company's key vault as a test drives it: its keys, and what the company does to them. */
export interface KeyVaultWorld {
  readonly vault: KeyVault;
  /** A new company key the installation may use. */
  aCompanyKey(): Promise<CompanyKeyReference>;
  /** The company disables its key. */
  disable(companyKey: CompanyKeyReference): Promise<void>;
  /** The company enables its key again. */
  enable(companyKey: CompanyKeyReference): Promise<void>;
  /** The company's key policy no longer grants the installation its key. */
  refuseGrant(companyKey: CompanyKeyReference): Promise<void>;
  /**
   * The company's key policy grants the installation its key for this fleet
   * alone: a condition on the encryption context naming the fleet id (B3).
   */
  bindToFleet(companyKey: CompanyKeyReference, fleetId: FleetId): Promise<void>;
  /** A key reference the vault knows nothing of. */
  readonly missingKey: CompanyKeyReference;
}

const FLEET: FleetId = 'flt_01m62dg2f1v5nndyp9ft549m90';
const OTHER_FLEET: FleetId = 'flt_01m62dg2f1v5nndyp9ft549m93';
const DATA_KEY_BYTES = 32;

export function describeKeyVault(name: string, worldOf: () => KeyVaultWorld): void {
  describe(`${name} (decision 0068, B2)`, () => {
    let world: KeyVaultWorld;
    let companyKey: CompanyKeyReference;

    beforeEach(async () => {
      world = worldOf();
      companyKey = await world.aCompanyKey();
    });

    it('makes a 256-bit data key under the company key, and unwraps it again for its fleet', async () => {
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));

      const unwrapped = unwrap(await world.vault.unwrap({ fleetId: FLEET, companyKey }, made.wrapped));

      expect(made.material).toHaveLength(DATA_KEY_BYTES);
      expect(made.wrapped).not.toEqual(made.material);
      expect(unwrapped).toEqual(made.material);
    });

    it('wraps a given data key, which unwraps to the same bytes', async () => {
      const material = new Uint8Array(DATA_KEY_BYTES).fill(42);

      const wrapped = unwrap(await world.vault.wrap({ fleetId: FLEET, companyKey }, material));

      expect(unwrap(await world.vault.unwrap({ fleetId: FLEET, companyKey }, wrapped))).toEqual(material);
    });

    it('rewraps a data key from one company key to another, which alone unwraps it then', async () => {
      const newCompanyKey = await world.aCompanyKey();
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));

      const rewrapped = unwrap(await world.vault.rewrap({ fleetId: FLEET, from: companyKey, to: newCompanyKey }, made.wrapped));

      expect(unwrap(await world.vault.unwrap({ fleetId: FLEET, companyKey: newCompanyKey }, rewrapped))).toEqual(made.material);
      expect(await world.vault.unwrap({ fleetId: FLEET, companyKey }, rewrapped)).toEqual({
        isOk: false,
        error: { kind: 'keyUnavailable', reason: 'invalidWrap' },
      });
    });

    it("does not unwrap a fleet's data key for another fleet", async () => {
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));

      const unwrapped = await world.vault.unwrap({ fleetId: OTHER_FLEET, companyKey }, made.wrapped);

      expect(unwrapped).toEqual({ isOk: false, error: { kind: 'keyUnavailable', reason: 'invalidWrap' } });
    });

    it('refuses every call with a company key whose grant the company took away: access denied', async () => {
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));
      const otherKey = await world.aCompanyKey();
      await world.refuseGrant(companyKey);

      const refused = { isOk: false, error: { kind: 'keyUnavailable', reason: 'accessDenied' } };
      expect(await world.vault.makeDataKey({ fleetId: FLEET, companyKey })).toEqual(refused);
      expect(await world.vault.unwrap({ fleetId: FLEET, companyKey }, made.wrapped)).toEqual(refused);
      expect(await world.vault.wrap({ fleetId: FLEET, companyKey }, made.material)).toEqual(refused);
      expect(await world.vault.rewrap({ fleetId: FLEET, from: companyKey, to: otherKey }, made.wrapped)).toEqual(refused);
    });

    it('refuses every call with a company key the company disabled: disabled', async () => {
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));
      const otherKey = await world.aCompanyKey();
      await world.disable(companyKey);

      const refused = { isOk: false, error: { kind: 'keyUnavailable', reason: 'disabled' } };
      expect(await world.vault.makeDataKey({ fleetId: FLEET, companyKey })).toEqual(refused);
      expect(await world.vault.unwrap({ fleetId: FLEET, companyKey }, made.wrapped)).toEqual(refused);
      expect(await world.vault.wrap({ fleetId: FLEET, companyKey }, made.material)).toEqual(refused);
      expect(await world.vault.rewrap({ fleetId: FLEET, from: companyKey, to: otherKey }, made.wrapped)).toEqual(refused);
    });

    it("refuses a company key bound to its fleet for another fleet's context: access denied (B4)", async () => {
      await world.bindToFleet(companyKey, FLEET);
      const made = unwrap(await world.vault.makeDataKey({ fleetId: FLEET, companyKey }));

      const refused = { isOk: false, error: { kind: 'keyUnavailable', reason: 'accessDenied' } };
      expect(await world.vault.makeDataKey({ fleetId: OTHER_FLEET, companyKey })).toEqual(refused);
      expect(await world.vault.unwrap({ fleetId: OTHER_FLEET, companyKey }, made.wrapped)).toEqual(refused);
      expect(unwrap(await world.vault.unwrap({ fleetId: FLEET, companyKey }, made.wrapped))).toEqual(made.material);
    });

    it('refuses a company key it does not know: not found', async () => {
      expect(await world.vault.makeDataKey({ fleetId: FLEET, companyKey: world.missingKey })).toEqual({
        isOk: false,
        error: { kind: 'keyUnavailable', reason: 'notFound' },
      });
    });
  });
}
