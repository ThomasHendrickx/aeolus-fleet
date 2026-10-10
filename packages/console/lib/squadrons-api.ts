import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewLine } from '@aeolus-fleet/common';

import type { formMembersOf } from './forming-members';
import { useAnalytics } from './analytics-client';
import { fetchConsoleRead } from './fetch-console-read';
import { dataOf } from './plugin-answer';
import { useSquadronsConnection } from './squadrons';
import { addMember, addRepository, forceStandDown, formSquadron, newCrewLine, refreshCatalogue, removeMember, removeRepository, standDown } from './squadrons-actions';
import type { FormedSquadron } from './squadrons-schemas';

/**
 * The squadrons API as the browser reads it: the catalogue, the squadrons,
 * and forming. Reads are console reads (lib/console-reads.ts), changes server
 * functions (lib/squadrons-actions.ts); either calls squadrons and parses its
 * answer on the web app's server.
 */

const SQUADRONS_KEY = ['squadrons', 'list'];
/** How often the lists ask again: forming members check in on their own time. */
const REFRESH_MS = 5_000;

/** Every squadron of the fleet, oldest first, asked again every few seconds; asked only while squadrons is connected. */
export function useSquadrons() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: SQUADRONS_KEY,
    queryFn: () => fetchConsoleRead({ read: 'squadrons' }),
    refetchInterval: REFRESH_MS,
    enabled: isConnected,
  });
}

/** The messages a squadron's flagship kept because it does not handle them, oldest first, asked again every few seconds. */
export function useKeptMessages(squadronId: string) {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: ['squadrons', 'messages', squadronId],
    queryFn: () => fetchConsoleRead({ read: 'kept-messages', input: { squadronId } }),
    refetchInterval: REFRESH_MS,
    enabled: isConnected,
  });
}

/** The templates and blueprints tagged in git; asked only while squadrons is connected. */
export function useCatalogue() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: ['squadrons', 'catalogue'],
    queryFn: () => fetchConsoleRead({ read: 'catalogue' }),
    enabled: isConnected,
  });
}

/** Each member a blueprint version forms, by slot, with its merged crew settings; asked once a version is picked. */
export function useBlueprintCrew(blueprint: { repository: string; name: string; version: number } | undefined) {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: ['squadrons', 'blueprint-crew', blueprint],
    queryFn: async () => (blueprint === undefined ? [] : fetchConsoleRead({ read: 'blueprint-crew', input: blueprint })),
    enabled: isConnected && blueprint !== undefined,
  });
}

/**
 * Forms a squadron from a blueprint version. The answer holds each member's
 * crew lines and launch note: shown once, kept only in this browser's memory.
 */
export function useFormSquadron() {
  const queryClient = useQueryClient();
  const { track } = useAnalytics();
  return useMutation({
    mutationFn: async ({ blueprint, members }: { blueprint: { repository: string; name: string; version: number }; members?: ReturnType<typeof formMembersOf> }) =>
      dataOf(await formSquadron({ blueprint, ...(members === undefined ? {} : { members }) })),
    onSuccess: async (formed) => {
      track({ name: 'squadron_formed', roleCount: new Set(formed.members.map((member) => member.role)).size });
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
    mutationFn: async (squadronId: string) => dataOf(await standDown(squadronId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Forces a squadron's stand down: every member and the flagship retire now, abandoning open work, and it disbands. */
export function useForceStandDown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (squadronId: string) => dataOf(await forceStandDown(squadronId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Adds one member of a role to a sailing squadron; the answer holds its crew lines and launch note, shown once. */
export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: { squadronId: string; role: string }) => dataOf(await addMember(member)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** Removes one member: its ship retires at once, abandoning what its inbox holds. */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: { squadronId: string; shipId: string }) => dataOf(await removeMember(member)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

/** A member's new crew lines: releases its ship if crewed; the answer, with its launch note, is shown once. */
export function useNewCrewLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (member: { squadronId: string; shipId: string }) => dataOf(await newCrewLine(member)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SQUADRONS_KEY });
    },
  });
}

function crewLinesKey(squadronId: string): string[] {
  return ['squadrons', 'crew-lines', squadronId];
}

/** The crew lines forming handed out for this squadron, by ship id, while this browser still holds them. */
export function useIssuedCrewLines(squadronId: string): ReadonlyMap<string, { crewLines: readonly CrewLine[]; launchNote: string | null; model: string | null }> {
  const members = useQueryClient().getQueryData<FormedSquadron['members']>(crewLinesKey(squadronId)) ?? [];
  return new Map(members.map((member) => [member.shipId, { crewLines: member.crewLines, launchNote: member.launchNote, model: member.model }]));
}

const REPOSITORIES_KEY = ['squadrons', 'repositories'];

/** The repositories squadrons reads templates and blueprints from, with their last fetch; asked only while squadrons is connected. */
export function useRepositories() {
  const isConnected = useSquadronsConnection() === 'connected';
  return useQuery({
    queryKey: REPOSITORIES_KEY,
    queryFn: () => fetchConsoleRead({ read: 'repositories' }),
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
    mutationFn: async (repository: { url: string; path?: string; token?: string }) => dataOf(await addRepository(repository)),
    // Also after a failure: a timeout may come after squadrons stored it.
    onSettled: refresh,
  });
}

/** Removes a repository: its versions leave the catalogue at once. */
export function useRemoveRepository() {
  const refresh = useRefreshRepositories();
  return useMutation({
    mutationFn: async (name: string) => dataOf(await removeRepository(name)),
    // Also after a failure: a timeout may come after squadrons removed it.
    onSettled: refresh,
  });
}

/** Fetches every repository now: the one way to refresh, as squadrons never fetches by itself. */
export function useRefreshCatalogue() {
  const refresh = useRefreshRepositories();
  return useMutation({
    mutationFn: async () => dataOf(await refreshCatalogue()),
    onSuccess: refresh,
  });
}
