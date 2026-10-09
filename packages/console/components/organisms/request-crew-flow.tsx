'use client';

import type { CrewSettings, ShipId } from '@aeolus-fleet/common';
import { useState, type ReactNode } from 'react';

import { defaultValues, offersOf, settingsOf, valuesOf } from '../../lib/crew-settings-form';
import { useCrewSettings } from '../../lib/crew-settings';
import { useLabelContext, useRequestCrew } from '../../lib/fleet';
import { machineLabelsInputOf } from '../../lib/machine-labels';
import { useSquadronsConnection } from '../../lib/squadrons';
import { useSquadrons } from '../../lib/squadrons-api';
import { useCrewSettingsCheck, useMachines } from '../../lib/trierarch-plugin';
import { showToast } from '../atoms/toast';
import { RequestCrewDialog } from './request-crew-dialog';

/** The ship asked for, and the settings its request holds, for Edit. */
interface RequestCrewFor {
  shipId: ShipId;
  shipName: string;
  heldSettings?: unknown;
}

/**
 * Request crew with settings, or Edit them, as a flow (#245, S3): `open`
 * opens the form, built from what the machines offer; the trierarch plugin
 * checks the settings as the form changes, and once more when requesting. A
 * refusal requests nothing; otherwise the fleet stores the settings as a new
 * version, and a request held restarts with them (decision 3). `onRequested`
 * runs after the request is stored, as Commission and request crew needs.
 */
export function useRequestCrewFlow(of: RequestCrewFor | undefined): { open: (mode: 'request' | 'edit') => void; dialog: ReactNode } {
  const machines = useMachines();
  const squadronsConnection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const requestCrew = useRequestCrew();
  const labelContext = useLabelContext();
  const [mode, setMode] = useState<'request' | 'edit'>();
  // Null until the form changes: the check then asks for the settings the form starts with.
  const [edited, setEdited] = useState<CrewSettings | undefined | null>(null);
  const [refusedAt, setRefusedAt] = useState<Date>();
  const offers = offersOf(machines.data ?? []);
  const machineLabels = labelContext === undefined || machines.data === undefined ? undefined : machineLabelsInputOf(labelContext, machines.data);
  // The held settings, parsed on the web app's server: Edit opens once they are read.
  const parsedHeld = useCrewSettings(of?.heldSettings === undefined ? [] : [of.heldSettings]);
  const held = parsedHeld?.[0] ?? null;
  const initial = settingsOf(mode === 'edit' ? valuesOf(held, offers) : defaultValues(offers));
  const isOpen = mode !== undefined && of !== undefined && (mode !== 'edit' || parsedHeld !== undefined);
  const settings = edited === null ? initial : edited;
  const check = useCrewSettingsCheck(isOpen && machines.data !== undefined ? settings : undefined);

  const submit = async (picked: CrewSettings) => {
    if (of === undefined || mode === undefined) {
      return;
    }
    requestCrew.reset();
    try {
      // Asked afresh at the moment of requesting: a refusal requests nothing.
      const now = await check.checkNow();
      if (now.kind === 'refused') {
        setRefusedAt(new Date());
        return;
      }
    } catch {
      // The plugin did not answer the check: the fleet still takes the request, and assignment checks it again.
    }
    requestCrew.mutate(
      { shipId: of.shipId, settings: picked },
      {
        onSuccess: () => {
          setMode(undefined);
          showToast(
            mode === 'edit'
              ? { title: `Settings saved for ${of.shipName}`, description: 'Its trierarch restarts the session with them.', tone: 'success' }
              : { title: `Crew requested for ${of.shipName}`, description: 'The trierarch plugin assigns a trierarch that fits.', tone: 'success' },
          );
        },
      },
    );
  };

  return {
    open: (next) => {
      requestCrew.reset();
      setEdited(null);
      setRefusedAt(undefined);
      setMode(next);
    },
    dialog:
      of === undefined ? null : (
        <RequestCrewDialog
          shipName={of.shipName}
          mode={mode ?? 'request'}
          state={machines.isError ? 'unreachable' : machines.data === undefined ? 'loading' : 'ready'}
          offers={offers}
          heldSettings={held}
          squadrons={squadronsConnection === 'connected' ? (squadrons.data ?? []).filter((squadron) => squadron.state !== 'disbanded').map((squadron) => squadron.id) : undefined}
          {...(machineLabels === undefined ? {} : { machineLabels })}
          check={check.data}
          refusedAt={refusedAt}
          error={requestCrew.error?.message}
          isPending={requestCrew.isPending}
          isOpen={isOpen}
          onOpenChange={(isNowOpen) => {
            if (!isNowOpen) {
              setMode(undefined);
            }
          }}
          onSettingsChange={(next) => {
            setEdited(next);
            setRefusedAt(undefined);
          }}
          onSubmit={(picked) => void submit(picked)}
          onRetry={() => {
            void machines.refetch();
          }}
        />
      ),
  };
}
