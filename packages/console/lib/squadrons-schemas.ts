import { crewLineSchema, idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { MEMBER_HEALTHS, SQUADRON_STATES } from './squadron-states';

/**
 * squadrons' answers as the web app's server parses them (decision 0033):
 * outside data, checked here before any reaches the browser, which imports
 * only the types.
 */

const templateReferenceSchema = z.object({
  repository: z.string(),
  name: z.string(),
  version: z.number(),
});

export const catalogueSchema = z.object({
  templates: z.array(
    z.object({
      repository: z.string(),
      name: z.string(),
      version: z.number(),
      commit: z.string(),
      committedAt: z.string(),
      description: z.string(),
      checkInMinutes: z.number(),
      model: z.string().nullable(),
      launchNote: z.string().nullable(),
      charter: z.string(),
      handoffs: z.array(z.object({ name: z.string(), carries: z.string() })),
      /** Its path within its repository at its commit. */
      file: z.string(),
    }),
  ),
  blueprints: z.array(
    z.object({
      repository: z.string(),
      name: z.string(),
      version: z.number(),
      commit: z.string(),
      committedAt: z.string(),
      description: z.string(),
      roles: z.array(
        z.object({
          name: z.string(),
          template: templateReferenceSchema,
          count: z.number(),
        }),
      ),
      handoffs: z.array(z.object({ role: z.string(), handoff: z.string(), to: z.string() })),
      memberNames: z.enum(['plain', 'prefixed']),
      /** Its path within its repository at its commit. */
      file: z.string(),
    }),
  ),
  /** Every version left out, and every version tag nothing was read at, with why (docs/squadrons.md, "Common mistakes"). */
  problems: z.array(
    z.object({
      repository: z.string(),
      kind: z.enum(['template', 'blueprint', 'tag']),
      name: z.string(),
      version: z.number(),
      message: z.string(),
    }),
  ),
});

export type Catalogue = z.infer<typeof catalogueSchema>;
export type BlueprintVersion = Catalogue['blueprints'][number];
export type TemplateVersion = Catalogue['templates'][number];
export type CatalogueProblem = Catalogue['problems'][number];

export const squadronSchema = z.object({
  id: z.string(),
  state: z.enum(SQUADRON_STATES),
  blueprint: z.object({
    repository: z.string(),
    name: z.string(),
    version: z.number(),
    commit: z.string(),
  }),
  flagship: z.object({ shipId: idSchema('ship'), name: z.string() }),
  members: z.array(
    z.object({
      shipId: idSchema('ship'),
      name: z.string(),
      role: z.string(),
      type: z.string(),
      onStationAt: z.string().nullable(),
      model: z.object({
        pinned: z.string().nullable(),
        stated: z.string().nullable(),
        isMismatch: z.boolean(),
      }),
      health: z.enum(MEMBER_HEALTHS),
      checkInMinutes: z.number(),
      crew: z.object({ status: z.enum(['awaitingCrew', 'crewed', 'retired']), lastSeenAt: z.string().nullable(), crewedSince: z.string().nullable() }),
    }),
  ),
  formedAt: z.string(),
  sailedAt: z.string().nullable(),
});

export type Squadron = z.infer<typeof squadronSchema>;

export const formedSquadronSchema = z.object({
  squadronId: z.string(),
  flagship: z.object({ shipId: z.string(), name: z.string() }),
  members: z.array(
    z.object({
      shipId: z.string(),
      name: z.string(),
      role: z.string(),
      crewLines: z.array(crewLineSchema),
      launchNote: z.string().nullable(),
      model: z.string().nullable(),
    }),
  ),
});

export type FormedSquadron = z.infer<typeof formedSquadronSchema>;

export const keptMessageSchema = z.object({
  deliveryId: z.string(),
  messageId: z.string(),
  senderShipId: z.string(),
  senderName: z.string(),
  contentType: z.string(),
  payload: z.string(),
  inReplyTo: z.string().nullable(),
  receivedAt: z.string(),
});

export type KeptMessage = z.infer<typeof keptMessageSchema>;

/** A member a blueprint forms, with its crew settings merged from its files: what the forming form starts from (#343). */
export const memberDraftSchema = z.object({
  slot: z.string(),
  role: z.string(),
  template: z.object({ repository: z.string(), name: z.string(), version: z.number() }),
  crew: z.object({
    harness: z.string().optional(),
    workspace: z.discriminatedUnion('kind', [z.object({ kind: z.literal('worktree'), repository: z.string(), ref: z.string().optional() }), z.object({ kind: z.literal('folder'), name: z.string() })]).optional(),
    firstPrompt: z.string().optional(),
    options: z.record(z.string(), z.unknown()),
    machineLabels: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  }),
  parameters: z.array(z.object({ name: z.string(), description: z.string(), value: z.string().nullable() })),
});

export const addedMemberSchema = z.object({
  shipId: idSchema('ship'),
  name: z.string(),
  role: z.string(),
  crewLines: z.array(crewLineSchema),
  launchNote: z.string().nullable(),
  model: z.string().nullable(),
});

export type AddedMember = z.infer<typeof addedMemberSchema>;

export const newCrewLineSchema = z.object({ crewLines: z.array(crewLineSchema), launchNote: z.string().nullable(), model: z.string().nullable() });

export type NewCrewLine = z.infer<typeof newCrewLineSchema>;

export const repositorySchema = z.object({
  name: z.string(),
  url: z.string(),
  path: z.string(),
  hasToken: z.boolean(),
  addedAt: z.string(),
  lastFetch: z.object({ at: z.string(), error: z.string().nullable() }).nullable(),
});

export type TemplateRepository = z.infer<typeof repositorySchema>;

export type MemberDraft = z.infer<typeof memberDraftSchema>;
