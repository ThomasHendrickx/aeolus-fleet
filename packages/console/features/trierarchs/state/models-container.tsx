'use client';

import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { useAccess } from '../../../lib/access';
import { useEnabledModels, useMachines, useSetModelEnabled } from '../../../lib/trierarch-plugin';
import { fleetWideChangeOf, modelRowsOf } from '../services/model-rows';
import { ModelRuleDialog, type ModelRuleChange } from '../ui/organisms/model-rule-dialog';
import { ModelsSection, type ModelChange } from '../ui/organisms/models-section';

/** What the toast says once a change is stored, by what it did to the fleet. */
function doneWords(change: ModelChange, kind: ModelRuleChange['kind'] | undefined): { title: string; description: string } {
  if (change.isEnabled) {
    return {
      title: `${change.model} enabled`,
      description: kind === 'first' ? 'Only enabled models are placed from now on.' : 'The trierarch plugin places it from its next assignment pass.',
    };
  }
  return {
    title: `${change.model} disabled`,
    description: kind === 'last' ? 'Every model is allowed again.' : 'New crew requests for it wait; crews already running keep it.',
  };
}

/**
 * The Trierarchs page's Models section (model governance, M7): the fleet's
 * enabled models beside what the machines report, each with its Switch.
 * The first model enabled and the last disabled change the whole fleet, so
 * they ask first; every other Switch is instant.
 */
export function ModelsContainer() {
  const machines = useMachines();
  const enabledModels = useEnabledModels();
  const setModelEnabled = useSetModelEnabled();
  const access = useAccess();
  const [confirming, setConfirming] = useState<ModelRuleChange>();
  const [failed, setFailed] = useState<ModelChange & { message: string }>();
  const enabled = enabledModels.data;
  const rows = enabled === undefined || machines.data === undefined ? undefined : modelRowsOf(machines.data, enabled);
  const readError = enabledModels.isError ? enabledModels.error.message : machines.isError ? machines.error.message : undefined;

  const save = (change: ModelChange) => {
    const kind = fleetWideChangeOf(enabled ?? [], change);
    setFailed(undefined);
    setModelEnabled.mutate(change, {
      onSuccess: () => {
        setConfirming(undefined);
        showToast({ ...doneWords(change, kind), tone: 'success' });
      },
      onError: (error) => {
        // In the confirm the error shows there; otherwise by the row, its Switch back where it was.
        if (kind === undefined) {
          setFailed({ ...change, message: error.message });
        }
      },
    });
  };

  return (
    <>
      <ModelsSection
        rows={rows}
        {...(readError === undefined ? {} : { error: readError })}
        onRetry={() => {
          void enabledModels.refetch();
          void machines.refetch();
        }}
        canManage={access.canManage}
        {...(setModelEnabled.isPending && confirming === undefined ? { pending: setModelEnabled.variables } : {})}
        {...(failed === undefined ? {} : { failed })}
        onChange={(change) => {
          const kind = fleetWideChangeOf(enabled ?? [], change);
          if (kind === undefined) {
            save(change);
            return;
          }
          setModelEnabled.reset();
          setConfirming({ model: change.model, kind });
        }}
      />
      <ModelRuleDialog
        change={confirming}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setConfirming(undefined);
          }
        }}
        isPending={setModelEnabled.isPending}
        {...(confirming !== undefined && setModelEnabled.error !== null ? { error: setModelEnabled.error.message } : {})}
        onConfirm={() => {
          if (confirming !== undefined) {
            save({ model: confirming.model, isEnabled: confirming.kind === 'first' });
          }
        }}
      />
    </>
  );
}
