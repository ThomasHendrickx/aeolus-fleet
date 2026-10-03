import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

/**
 * The squadrons API as the console reads it, through the web app's server
 * (`/api/squadrons/<procedure>`): the catalogue, the squadrons, and forming.
 * squadrons' answers are outside data, so each is parsed here.
 */

export const SQUADRON_STATES = ['forming', 'sailing', 'standing-down', 'disbanded'] as const;
export type SquadronState = (typeof SQUADRON_STATES)[number];

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

/** Every squadron of the fleet, oldest first, asked again every few seconds. */
export function useSquadrons() {
  return useQuery({
    queryKey: SQUADRONS_KEY,
    queryFn: () => call('squadrons.list', { answers: z.array(squadronSchema) }),
    refetchInterval: REFRESH_MS,
  });
}

/** The templates and blueprints tagged in git. */
export function useCatalogue() {
  return useQuery({
    queryKey: ['squadrons', 'catalogue'],
    queryFn: () => call('catalogue.list', { answers: catalogueSchema }),
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

function crewLinesKey(squadronId: string): string[] {
  return ['squadrons', 'crew-lines', squadronId];
}

/** The crew lines forming handed out for this squadron, by ship id, while this browser still holds them. */
export function useIssuedCrewLines(squadronId: string): ReadonlyMap<string, { crewLine: string; launchNote: string | null }> {
  const members = useQueryClient().getQueryData<FormedSquadron['members']>(crewLinesKey(squadronId)) ?? [];
  return new Map(members.map((member) => [member.shipId, { crewLine: member.crewLine, launchNote: member.launchNote }]));
}
