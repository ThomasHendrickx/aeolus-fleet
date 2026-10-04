import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useSquadronsConnection } from './squadrons';

/**
 * The squadrons API as the console reads it, through the web app's server
 * (`/api/squadrons/<procedure>`): the catalogue, the squadrons, and forming.
 * squadrons' answers are outside data, so each is parsed here.
 */

export const SQUADRON_STATES = ['forming', 'sailing', 'standing-down', 'disbanded'] as const;
export type SquadronState = (typeof SQUADRON_STATES)[number];

/** A member's health (docs/squadrons.md): not on station until it is, then on time, late or silent by its last report. */
export const MEMBER_HEALTHS = ['not-on-station', 'on-time', 'late', 'silent'] as const;
export type MemberHealth = (typeof MEMBER_HEALTHS)[number];

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
});

export type Catalogue = z.infer<typeof catalogueSchema>;
export type BlueprintVersion = Catalogue['blueprints'][number];
export type TemplateVersion = Catalogue['templates'][number];

export const squadronSchema = z.object({
  id: z.string(),
  state: z.enum(SQUADRON_STATES),
  blueprint: z.object({
    repository: z.string(),
    name: z.string(),
    version: z.number(),
    commit: z.string(),
  }),
  flagship: z.object({ shipId: z.string(), name: z.string() }),
  members: z.array(
    z.object({
      shipId: z.string(),
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
      crewLine: z.string(),
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

const answerSchema = z.union([z.object({ result: z.object({ data: z.unknown() }) }), z.object({ error: z.object({ message: z.string() }) })]);

async function call<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; answers: z.ZodType<T> }): Promise<T> {
  const path = `/api/squadrons/${procedure}`;
  const response = request.isMutation
    ? await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.input ?? {}),
      })
    : await fetch(request.input === undefined ? path : `${path}?input=${encodeURIComponent(JSON.stringify(request.input))}`, { cache: 'no-store' });
  const answer = answerSchema.safeParse(await response.json());
  if (!answer.success) {
    throw new Error('squadrons answered something the console does not understand');
  }
  if ('error' in answer.data) {
    throw new Error(answer.data.error.message);
  }
  return request.answers.parse(answer.data.result.data);
}

const SQUADRONS_KEY = ['squadrons', 'list'];
/** How often the lists ask again: forming members check in on their own time. */
const REFRESH_MS = 5_000;

/** Every squadron of the fleet, oldest first, asked again every few seconds; asked only while squadrons is connected. */
export function useSquadrons() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: SQUADRONS_KEY,
    queryFn: () => call('squadrons.list', { answers: z.array(squadronSchema) }),
    refetchInterval: REFRESH_MS,
    enabled: isConnected,
  });
}

/** The messages a squadron's flagship kept because it does not handle them, oldest first, asked again every few seconds. */
export function useKeptMessages(squadronId: string) {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: ['squadrons', 'messages', squadronId],
    queryFn: () => call('squadrons.messages', { input: { squadronId }, answers: z.array(keptMessageSchema) }),
    refetchInterval: REFRESH_MS,
    enabled: isConnected,
  });
}

/** The templates and blueprints tagged in git; asked only while squadrons is connected. */
export function useCatalogue() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: ['squadrons', 'catalogue'],
    queryFn: () => call('catalogue.list', { answers: catalogueSchema }),
    enabled: isConnected,
  });
}

/**
 * Forms a squadron from a blueprint version. The answer holds each member's
 * crew line and launch note: shown once, kept only in this browser's memory.
 */
export function useFormSquadron() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blueprint: { repository: string; name: string; version: number }) =>
      call('squadrons.form', {
        input: { blueprint },
        isMutation: true,
        answers: formedSquadronSchema,
      }),
    onSuccess: async (formed) => {
      // In this browser's memory only, for the squadron page to show once; never in storage.
      queryClient.setQueryData(crewLinesKey(formed.squadronId), formed.members);
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Stands a sailing squadron down: its members finish their open work, then retire, and it disbands. */
export function useStandDown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (squadronId: string) => call('squadrons.standDown', { input: { squadronId }, isMutation: true, answers: z.object({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Forces a squadron's stand down: every member and the flagship retire now, abandoning open work, and it disbands. */
export function useForceStandDown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (squadronId: string) => call('squadrons.forceStandDown', { input: { squadronId }, isMutation: true, answers: z.object({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

export const addedMemberSchema = z.object({
  shipId: z.string(),
  name: z.string(),
  role: z.string(),
  crewLine: z.string(),
  launchNote: z.string().nullable(),
  model: z.string().nullable(),
});

export type AddedMember = z.infer<typeof addedMemberSchema>;

/** Adds one member of a role to a sailing squadron; the answer holds its crew line and launch note, shown once. */
export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (member: { squadronId: string; role: string }) => call('squadrons.addMember', { input: member, isMutation: true, answers: addedMemberSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Removes one member: its ship retires at once, abandoning what its inbox holds. */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (member: { squadronId: string; shipId: string }) => call('squadrons.removeMember', { input: member, isMutation: true, answers: z.strictObject({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

export const newCrewLineSchema = z.object({ crewLine: z.string(), launchNote: z.string().nullable(), model: z.string().nullable() });

/** A member's new crew line: releases its ship if crewed; the answer, with its launch note, is shown once. */
export function useNewCrewLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (member: { squadronId: string; shipId: string }) => call('squadrons.newCrewLine', { input: member, isMutation: true, answers: newCrewLineSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

function crewLinesKey(squadronId: string): string[] {
  return ['squadrons', 'crew-lines', squadronId];
}

/** The crew lines forming handed out for this squadron, by ship id, while this browser still holds them. */
export function useIssuedCrewLines(squadronId: string): ReadonlyMap<string, { crewLine: string; launchNote: string | null }> {
  const members = useQueryClient().getQueryData<FormedSquadron['members']>(crewLinesKey(squadronId)) ?? [];
  return new Map(members.map((member) => [member.shipId, { crewLine: member.crewLine, launchNote: member.launchNote }]));
}

export const repositorySchema = z.object({
  name: z.string(),
  url: z.string(),
  path: z.string(),
  hasToken: z.boolean(),
  addedAt: z.string(),
  lastFetch: z.object({ at: z.string(), error: z.string().nullable() }).nullable(),
});

export type TemplateRepository = z.infer<typeof repositorySchema>;

const REPOSITORIES_KEY = ['squadrons', 'repositories'];

/** The repositories squadrons reads templates and blueprints from, with their last fetch; asked only while squadrons is connected. */
export function useRepositories() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: REPOSITORIES_KEY,
    queryFn: () => call('repositories.list', { answers: z.array(repositorySchema) }),
    enabled: isConnected,
  });
}

/** After a repository changes: its fetch, and the catalogue it feeds. */
function useRefreshRepositories() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: REPOSITORIES_KEY }), queryClient.invalidateQueries({ queryKey: ['squadrons', 'catalogue'] })]);
  };
}

/** Adds a repository by its https URL, with an optional path and read token; squadrons fetches it at once. */
export function useAddRepository() {
  const refresh = useRefreshRepositories();
  return useMutation({
    mutationFn: (repository: { url: string; path?: string; token?: string }) =>
      call('repositories.add', { input: repository, isMutation: true, answers: repositorySchema }),
    onSuccess: refresh,
  });
}

/** Removes a repository: its versions leave the catalogue at once. */
export function useRemoveRepository() {
  const refresh = useRefreshRepositories();
  return useMutation({
    mutationFn: (name: string) => call('repositories.remove', { input: { name }, isMutation: true, answers: z.strictObject({}) }),
    onSuccess: refresh,
  });
}

/** Fetches every repository now: the one way to refresh, as squadrons never fetches by itself. */
export function useRefreshCatalogue() {
  const refresh = useRefreshRepositories();
  return useMutation({
    mutationFn: () => call('catalogue.refresh', { isMutation: true, answers: z.strictObject({}) }),
    onSuccess: refresh,
  });
}
