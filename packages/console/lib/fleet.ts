import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAccess } from './access';
import { useAnalytics } from './analytics-client';
import { labelContextOf, type LabelContext } from './labels';
import { useTRPC } from './trpc';

/**
 * How often an open console reads the snapshot again: last seen changes with
 * every call a ship makes, which writes no event, so no live update brings it.
 */
export const LAST_SEEN_REFRESH_MS = 30_000;

/** The fleet snapshot: every ship with its status, prompt state and when it was last seen. */
export function useFleetSnapshot() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.list.queryOptions(undefined, { refetchInterval: LAST_SEEN_REFRESH_MS }));
}

/** The fleet's labels (#102, decision 0031): each with its values and its owner, for chips and the label filter. */
export function useFleetLabels() {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.labels.queryOptions());
}

/**
 * The fleet's labels as chips and the label filter read them, with the
 * snapshot's ships; undefined until both are read. The operator's own labels
 * are argo's; a viewer owns none.
 */
export function useLabelContext(): LabelContext | undefined {
  const labels = useFleetLabels();
  const fleet = useFleetSnapshot();
  const access = useAccess();
  if (labels.data === undefined || fleet.data === undefined) {
    return undefined;
  }
  return labelContextOf(labels.data, { ships: fleet.data, isOperator: !access.isViewer });
}

/** Refreshes the fleet snapshot, and every ship page read, after a change to the fleet. */
function useRefreshFleetSnapshot(): () => Promise<void> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() });
}

/** Commissions a ship. Its data holds the first starting prompt, to show once. */
export function useCommissionShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  const { track } = useAnalytics();
  return useMutation(
    trpc.fleet.commission.mutationOptions({
      onSuccess: async () => {
        track({ name: 'ship_commissioned' });
        await refresh();
      },
    }),
  );
}

/** Gets a new starting prompt for a ship awaiting crew. Its data holds the prompt, to show once. */
export function useGetStartingPrompt() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.getStartingPrompt.mutationOptions({ onSuccess: refresh }));
}

/** Pings a crewed ship as argo. While a ping waits unanswered, the server answers with that one. */
export function usePingShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.ping.mutationOptions({ onSuccess: refresh }));
}

/** Releases a crewed ship: the session crewing it loses it, and the ship awaits a new crew. */
export function useReleaseShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.release.mutationOptions({ onSuccess: refresh }));
}

/**
 * Retires a ship for good: its lease and secret end, its direct deliveries are
 * abandoned. Its data says how many.
 */
export function useRetireShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.retire.mutationOptions({ onSuccess: refresh }));
}

/**
 * Re-crews a crewed ship whose session is gone: a release and a new starting
 * prompt at once. Its data holds the prompt and crew lines, to show once.
 */
export function useRecrewShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.recrew.mutationOptions({ onSuccess: refresh }));
}

/** Renames a ship; other ships addressing its old name no longer reach it. */
export function useRenameShip() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.rename.mutationOptions({ onSuccess: refresh }));
}

/**
 * Writes a ship's crew request, replacing any it holds, with a new settings
 * version: Request crew, and Restart, which writes the same settings again.
 */
export function useRequestCrew() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.crewRequest.mutationOptions({ onSuccess: refresh }));
}

/** Removes a ship's crew request: an unassigned one goes, an assigned one releases through its trierarch. */
export function useRemoveCrewRequest() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.removeCrewRequest.mutationOptions({ onSuccess: refresh }));
}

/** Defines a label argo then owns (decision 0031): its key and its values. A refusal names the rule or the key's owner. */
export function useDefineLabel() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.defineLabel.mutationOptions({ onSuccess: refresh }));
}

/** Gives one of argo's labels every value it has from now on: adding or removing one at once. A value ships carry is refused, naming them. */
export function useChangeLabelValues() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.changeLabelValues.mutationOptions({ onSuccess: refresh }));
}

/** Deletes one of argo's labels while no ship carries any of its values (#102, point 12). */
export function useDeleteLabel() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.deleteLabel.mutationOptions({ onSuccess: refresh }));
}

/** argo gives a ship one of its label values, beside the values it carries (decision 0031). A ship at 20 labels is refused, naming the limit. */
export function useAssignLabel() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.assignLabel.mutationOptions({ onSuccess: refresh }));
}

/** argo takes one of its label values off a ship. */
export function useUnassignLabel() {
  const trpc = useTRPC();
  const refresh = useRefreshFleetSnapshot();
  return useMutation(trpc.fleet.unassignLabel.mutationOptions({ onSuccess: refresh }));
}
