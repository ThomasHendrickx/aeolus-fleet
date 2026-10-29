import { idSchema, type SealingOutput } from '@aeolus-fleet/common';

/** The sealing page's stories, as the approved mockup shows them: the fleet northwind, now 29 Oct, 10:12. */
export const SEALING_NOW = new Date(2026, 9, 29, 10, 12);
export const SEALING_FLEET_ID = idSchema('fleet').parse('flt_01jb8xk4tqzr3a9w6m2v5nyb4c');

const COMPANY_KEY = 'arn:aws:kms:eu-central-1:441703952218:key/7f3c2a91-5d0e-4b8a-9c61-2e8f04d7b1a3';
const RECOVERY_KEY_FINGERPRINT = 'SHA256:q8fXo2Lm9bR4tY7wZk3d9';
const TURNED_ON = new Date(2026, 7, 29, 10, 12).toISOString();

const DATA_KEYS = [
  { id: idSchema('dataKey').parse('dky_01jag7m4xq2v9t5w8r3n2x2xhc'), createdAt: TURNED_ON, isCurrent: false },
  { id: idSchema('dataKey').parse('dky_01jbw2k8tq5z3r7n9w4vm8m8kd'), createdAt: new Date(2026, 8, 28, 10, 12).toISOString(), isCurrent: false },
  { id: idSchema('dataKey').parse('dky_01jd4r6vq9w2t8m5x3k7q17q1f'), createdAt: new Date(2026, 9, 28, 10, 12).toISOString(), isCurrent: true },
];

type SealedFleet = Exclude<SealingOutput, { state: 'none' }>;

/** Sealed, the key reachable, with a recovery key and three data keys. */
export const SEALED: SealedFleet = {
  state: 'sealed',
  since: TURNED_ON,
  progress: null,
  companyKey: COMPANY_KEY,
  recoveryKeyFingerprint: RECOVERY_KEY_FINGERPRINT,
  keyAvailability: { isAvailable: true, since: TURNED_ON },
  dataKeys: DATA_KEYS,
};

/** Turned on 6 min ago: payloads from before are being sealed. */
export const SEALING: SealedFleet = {
  ...SEALED,
  state: 'sealing',
  since: new Date(2026, 9, 29, 10, 6).toISOString(),
  progress: { sealed: 2180, total: 3412 },
  dataKeys: DATA_KEYS.slice(-1),
};

/** Sealed without a recovery key: recovery is the KMS's own. */
export const SEALED_WITHOUT_RECOVERY_KEY: SealedFleet = { ...SEALED, recoveryKeyFingerprint: null };

/** The company cut its key off at 14:05 the day before. */
export const KEY_NOT_REACHABLE: SealedFleet = { ...SEALED, keyAvailability: { isAvailable: false, reason: 'accessDenied', since: new Date(2026, 9, 29, 9, 5).toISOString() } };
