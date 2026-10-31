import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * The feature flags there are (decision 0069): each a key, a name, one line
 * saying what it turns on, and the line the installation shows while a fleet
 * uses the feature, so the flag cannot go off. Core names them; pagasae lists
 * what core names, so a new flag needs no pagasae change.
 */
export const featureFlagSchema = z.enum(['sealing']);

export type FeatureFlag = z.infer<typeof featureFlagSchema>;

export const FEATURE_FLAGS: readonly FeatureFlagDescription[] = [
  {
    key: 'sealing',
    name: 'Sealing',
    description: 'The fleet may seal its payloads under its company’s own key (decision 0068).',
    inUseNote: 'Sealed fleets keep sealing',
  },
];

/** One flag as the installation lists it. */
export const featureFlagDescriptionSchema = z.object({
  key: featureFlagSchema,
  name: z.string(),
  description: z.string(),
  /** The line shown with the switch locked on while a fleet uses the feature. */
  inUseNote: z.string(),
});

export type FeatureFlagDescription = z.infer<typeof featureFlagDescriptionSchema>;

/** Output of `installation.featureFlags.list`: every flag core names. */
export const installationFeatureFlagsListOutputSchema = z.array(featureFlagDescriptionSchema);

/** One flag of one fleet: on or off, and whether it can go off now; it cannot while the fleet uses the feature. */
export const fleetFeatureFlagSchema = z.object({
  flag: featureFlagSchema,
  isOn: z.boolean(),
  canTurnOff: z.boolean(),
});

export type FleetFeatureFlag = z.infer<typeof fleetFeatureFlagSchema>;

/** Input of `installation.fleets.setFeatureFlag`: one flag on or off for one fleet. */
export const installationFleetsSetFeatureFlagInputSchema = z.strictObject({
  fleetId: idSchema('fleet'),
  flag: featureFlagSchema,
  isOn: z.boolean(),
});

export const installationFleetsSetFeatureFlagOutputSchema = fleetFeatureFlagSchema;
