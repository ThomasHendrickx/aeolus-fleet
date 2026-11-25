'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@aeolus-fleet/ui';
import type { FleetId } from '@aeolus-fleet/common';
import { useConsoleRead } from '../../../lib/console-read-query';
import { guardReplacement, type GuardChange, type GuardSaveError } from '../services/guard-configuration';
import { readGuardConfiguration, replaceGuardConfiguration } from './guard-configuration-client';

function done(change: GuardChange): string {
  switch (change.kind) {
    case 'add': return 'Repository added';
    case 'remove': return 'Repository removed';
    case 'floor': return change.isIncluded ? 'Rule set added to the floor' : 'Rule set removed from the floor';
  }
}

/** Keep the catalogue in the query cache and keep read tokens out of query and mutation state. */
export function useGuardConfiguration({ fleetId, isEnabled, canChange }: {
  fleetId: FleetId | undefined;
  isEnabled: boolean;
  canChange: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useConsoleRead({
    queryKey: ['trierarch-plugin', 'guard-configuration', fleetId],
    queryFn: ({ signal }) => readGuardConfiguration(signal),
    enabled: isEnabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const isWriting = useRef(false);
  const [action, setAction] = useState<GuardChange['kind']>();
  const [floorSave, setFloorSave] = useState<{ name: string; state: 'pending' | 'success' | 'failure' }>();
  const [error, setError] = useState<GuardSaveError>();
  const readAgain = async () => {
    const result = await query.refetch();
    if (result.isSuccess) setError(undefined);
    return result.isSuccess;
  };

  const save = async (change: GuardChange): Promise<boolean> => {
    if (!canChange || query.data === undefined || query.isError || query.isFetching || isWriting.current || error?.shouldReadAgain) return false;
    isWriting.current = true;
    setAction(change.kind);
    setError(undefined);
    setFloorSave(change.kind === 'floor' ? { name: change.name, state: 'pending' } : undefined);
    let didSave = false;
    try {
      const result = await replaceGuardConfiguration(guardReplacement(query.data, change));
      if (result.kind === 'saved') {
        await Promise.all([
          query.refetch(),
          queryClient.invalidateQueries({ queryKey: ['trierarch-plugin', 'guard-choices'] }),
        ]);
        showToast({ title: done(change) });
        didSave = true;
        return true;
      }
      if (result.kind === 'conflict') {
        const didRead = await readAgain();
        setError(didRead
          ? { message: 'Someone else changed the guard configuration. The latest rule sets are shown. Try again.' }
          : { message: 'Someone else changed the guard configuration. Read the rule sets again before saving.', shouldReadAgain: true });
      } else {
        setError({ message: result.message, shouldReadAgain: result.kind === 'uncertain' });
      }
      return false;
    } finally {
      isWriting.current = false;
      if (change.kind === 'floor') {
        setFloorSave({ name: change.name, state: didSave ? 'success' : 'failure' });
      }
      setAction(undefined);
    }
  };

  return {
    query, action, error, save, readAgain,
    floorSave: floorSave?.state === 'failure' && error === undefined ? undefined : floorSave,
    resetError: () => { setError((current) => current?.shouldReadAgain ? current : undefined); },
  };
}
