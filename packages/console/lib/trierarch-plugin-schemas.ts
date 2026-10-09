import { crewLineSchema, idSchema, trierarchReportDetailsSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

/**
 * The trierarch plugin's answers as the web app's server parses them
 * (decision 0033): outside data, checked here before any reaches the
 * browser, which imports only the types.
 */

/** A machine as the trierarch plugin lists it: its trierarch's ship, its last report and the details it reported. */
export const machineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  status: z.enum(['awaitingCrew', 'crewed']),
  lastSeenAt: z.string().nullable(),
  /** Its trierarch has not been seen for longer than the plugin's threshold. */
  isSilent: z.boolean(),
  report: z.object({ state: z.string(), note: z.string().nullable(), reportedAt: z.string() }).nullable(),
  details: trierarchReportDetailsSchema.nullable(),
});

export type Machine = z.infer<typeof machineSchema>;

/** A joined machine: its trierarch's ship, its starting prompt and crew lines, and its setup line, each shown once. */
export const joinedMachineSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  prompt: z.string(),
  crewLines: z.array(crewLineSchema),
  setupLine: z.string(),
});

export type JoinedMachine = z.infer<typeof joinedMachineSchema>;

/** What checking crew settings answers: a trierarch fits, none takes them (naming the settings field at fault), or none has room now. */
export const settingsCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fits') }),
  z.object({ kind: z.literal('refused'), field: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('noRoom'), reason: z.string() }),
]);

export type SettingsCheck = z.infer<typeof settingsCheckSchema>;
