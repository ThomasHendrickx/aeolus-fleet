'use client';

import type { CrewSettings } from '@aeolus-fleet/common';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { lazyDialog } from '../../lib/lazy-dialog';
import { useConsoleConstants } from '../../lib/console-constants';
import { defaultValues, offersOf, settingsOf } from '../../lib/crew-settings-form';
import { useCommissionShip, useFleetSnapshot, useLabelContext, useRequestCrew } from '../../lib/fleet';
import { machineLabelsInputOf } from '../../lib/machine-labels';
import { Button } from '../atoms/button';
import { showToast } from '../atoms/toast';
import { useFleetLimits } from '../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../lib/hosted-account';
import { shipLimitReached } from '../../lib/limits';
import { useSquadronsConnection } from '../../lib/squadrons';
import { useSquadrons } from '../../lib/squadrons-api';
import { useCrewSettingsCheck, useMachines, useTrierarchPluginConnection } from '../../lib/trierarch-plugin';

// Dialogs load when first opened, not with the page.
const CommissionDialog = lazyDialog(() => import('./commission-dialog').then((module) => module.CommissionDialog), (props) => props.isOpen);
const StartingPromptDialog = lazyDialog(() => import('./starting-prompt-dialog').then((module) => module.StartingPromptDialog), (props) => props.isOpen);

/**
 * Commission ship, the fleet overview's one primary action: the
 * CommissionDialog, then, once the ship exists, its crew request when Request
 * a crew is on (#245), and its first starting prompt in the
 * StartingPromptDialog, shown once. With the trierarch plugin connected, a ship
 * whose crew is requested gets no starting prompt here: a trierarch crews it.
 * The page or the command palette may open it too, through `isOpen`.
 */
export function CommissionShip({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void }) {
  const fleet = useFleetSnapshot();
  const limits = useFleetLimits();
  const accountUrl = useHostedAccountUrl();
  const commission = useCommissionShip();
  const requestCrew = useRequestCrew();
  // Only a connected plugin can place a request: until then, a request is crewed by hand.
  const hasTrierarchs = useTrierarchPluginConnection() === 'connected';
  const machines = useMachines();
  const squadronsConnection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  // Null until the form changes: the check then asks for the settings the form starts with.
  const [crewSettings, setCrewSettings] = useState<CrewSettings | undefined | null>(null);
  const offers = offersOf(machines.data ?? []);
  const labelContext = useLabelContext();
  const { shipLabelsMax } = useConsoleConstants();
  const machineLabels = labelContext === undefined || machines.data === undefined ? undefined : machineLabelsInputOf(labelContext, { machines: machines.data, shipLabelsMax });
  const check = useCrewSettingsCheck(isOpen && hasTrierarchs ? (crewSettings === null ? settingsOf(defaultValues(offers)) : crewSettings) : undefined);
  const activeShips = (fleet.data ?? []).filter((ship) => ship.status !== 'retired');

  const commissionThenRequest = (ship: Parameters<typeof commission.mutate>[0], request: { settings: CrewSettings | Record<string, never> } | undefined) => {
    commission.mutate(ship, {
      onSuccess: ({ shipId }) => {
        onOpenChange(false);
        const isCrewedByTrierarch = hasTrierarchs && request !== undefined;
        if (!isCrewedByTrierarch) {
          setIsPromptOpen(true);
        }
        if (request === undefined) {
          return;
        }
        requestCrew.mutate(
          { shipId, settings: request.settings },
          {
            onSuccess: () => {
              if (isCrewedByTrierarch) {
                showToast({ title: `${ship.name} commissioned, crew requested`, description: 'The trierarch plugin assigns a trierarch that fits.', tone: 'success' });
              }
            },
            onError: (error) => {
              showToast({ title: `Couldn’t request a crew for ${ship.name}`, description: `${error.message} The ship is commissioned; request a crew on its page.`, tone: 'error' });
            },
          },
        );
      },
    });
  };

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus />}
        data-testid="fleet-commission"
        onClick={() => {
          commission.reset();
          setCrewSettings(null);
          onOpenChange(true);
        }}
      >
        Commission ship
      </Button>
      <CommissionDialog
        activeShips={activeShips}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isPending={commission.isPending}
        error={commission.error?.message}
        shipLimit={shipLimitReached(limits.data)}
        accountUrl={accountUrl}
        {...(hasTrierarchs
          ? {
              crewRequest: {
                offers,
                squadrons: squadronsConnection === 'connected' ? (squadrons.data ?? []).filter((squadron) => squadron.state !== 'disbanded').map((squadron) => squadron.id) : undefined,
                ...(machineLabels === undefined ? {} : { machineLabels }),
                check: check.data,
                onSettingsChange: setCrewSettings,
              },
            }
          : {})}
        onSubmit={(ship, request) => {
          // A new key for every submission: the server's guard against a retried request, not a way to resubmit.
          const commissioned = { ...ship, idempotencyKey: crypto.randomUUID() };
          if (!hasTrierarchs || request === undefined) {
            commissionThenRequest(commissioned, request);
            return;
          }
          // Asked afresh before anything is commissioned: a refusal commissions nothing, and its field shows why.
          check
            .checkNow()
            .catch(() => undefined)
            .then((checked) => {
              if (checked?.kind !== 'refused') {
                commissionThenRequest(commissioned, request);
              }
            })
            .catch(() => undefined);
        }}
      />
      <StartingPromptDialog
        shipName={commission.variables?.name ?? ''}
        state="shown"
        prompt={commission.data?.prompt ?? undefined}
        crewLines={commission.data?.crewLines ?? undefined}
        isOpen={isPromptOpen && commission.data !== undefined}
        onOpenChange={(isNowOpen) => {
          if (!isNowOpen) {
            setIsPromptOpen(false);
            commission.reset();
          }
        }}
        onConfirm={() => undefined}
      />
    </>
  );
}
