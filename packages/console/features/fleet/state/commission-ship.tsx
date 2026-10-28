'use client';

import type { CrewSettings } from '@aeolus-fleet/common';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { lazyDialog } from '../../../lib/lazy-dialog';
import { useConsoleConstants } from '../../../lib/console-constants';
import { defaultValues, offersOf, settingsOf } from '../../../lib/crew-settings-form';
import { useCommissionShip, useFleetScopes, useGetStartingPrompt, useLabelContext, useRequestCrew } from '../../../lib/fleet';
import { machineLabelsInputOf } from '../../../lib/machine-labels';
import { useIsShipNameTaken } from '../../../lib/ship-name-taken';
import { Button } from '@aeolus-fleet/common/header';
import type { StartingPromptDialogState } from '../../../components/organisms/starting-prompt-dialog';
import { showToast } from '../../../components/atoms/toast';
import { useFleetLimits } from '../../../lib/fleet-limits';
import { useHostedAccountUrl } from '../../../lib/hosted-account';
import { shipLimitReached } from '../../../lib/limits';
import { useSquadronsConnection } from '../../../lib/squadrons';
import { useSquadrons } from '../../../lib/squadrons-api';
import { useCrewSettingsCheck, useEnabledModels, useMachines, useTrierarchPluginConnection } from '../../../lib/trierarch-plugin';
import { useShipTypes, useTypeShipCount } from '../../../lib/ship-types';
import { grantableScopes } from '../services/grantable-scopes';

// Dialogs load when first opened, not with the page.
const CommissionDialog = lazyDialog(() => import('../ui/organisms/commission-dialog').then((module) => module.CommissionDialog), (props) => props.isOpen);
const StartingPromptDialog = lazyDialog(() => import('../../../components/organisms/starting-prompt-dialog').then((module) => module.StartingPromptDialog), (props) => props.isOpen);

/**
 * Commission ship, the fleet overview's one primary action: the
 * CommissionDialog, then, once the ship exists, its crew request when Request
 * a crew is on (#245), and its first starting prompt in the
 * StartingPromptDialog, shown once. With the trierarch plugin connected, a ship
 * whose crew is requested gets no starting prompt here: a trierarch crews it.
 * The page or the command palette may open it too, through `isOpen`.
 */
export function CommissionShip({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void }) {
  const limits = useFleetLimits();
  const accountUrl = useHostedAccountUrl();
  const commission = useCommissionShip();
  const requestCrew = useRequestCrew();
  const getStartingPrompt = useGetStartingPrompt();
  // Only a connected plugin can place a request: until then, a request is crewed by hand.
  const hasTrierarchs = useTrierarchPluginConnection() === 'connected';
  const machines = useMachines();
  const enabledModels = useEnabledModels();
  const squadronsConnection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  // Null until the form changes: the check then asks for the settings the form starts with.
  const [crewSettings, setCrewSettings] = useState<CrewSettings | undefined | null>(null);
  const offers = offersOf(machines.data ?? [], enabledModels.data ?? []);
  const labelContext = useLabelContext(machines.data?.map((machine) => machine.shipId));
  const { shipLabelsMax, fleetScopes } = useConsoleConstants();
  const scopes = useFleetScopes();
  const machineLabels = labelContext === undefined || machines.data === undefined ? undefined : machineLabelsInputOf(labelContext, { machines: machines.data, shipLabelsMax });
  const check = useCrewSettingsCheck(isOpen && hasTrierarchs ? (crewSettings === null ? settingsOf(defaultValues(offers)) : crewSettings) : undefined);
  const types = useShipTypes(false);
  const [typed, setTyped] = useState({ name: '', type: '' });
  const isNameTaken = useIsShipNameTaken(typed.name);
  const typeShipCount = useTypeShipCount(typed.type);

  const issued = commission.data?.prompt == null ? getStartingPrompt.data : commission.data;
  const promptState: StartingPromptDialogState = issued ? 'shown' : getStartingPrompt.isError ? 'error' : 'issuing';

  const commissionThenRequest = (ship: Parameters<typeof commission.mutate>[0], request: { settings: CrewSettings | Record<string, never> } | undefined) => {
    commission.mutate(ship, {
      onSuccess: ({ shipId, prompt }) => {
        onOpenChange(false);
        const isCrewedByTrierarch = hasTrierarchs && request !== undefined;
        if (!isCrewedByTrierarch) {
          setIsPromptOpen(true);
          if (prompt === null) {
            getStartingPrompt.mutate({ shipId });
          }
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
          getStartingPrompt.reset();
          setCrewSettings(null);
          onOpenChange(true);
        }}
      >
        Commission ship
      </Button>
      <CommissionDialog
        types={types ?? []}
        taken={{ names: isNameTaken === true ? [typed.name] : [], typeShipCounts: new Map(typeShipCount === undefined ? [] : [[typed.type, typeShipCount]]) }}
        onTypedChange={setTyped}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isPending={commission.isPending}
        error={commission.error?.message}
        shipLimit={shipLimitReached(limits.data)}
        accountUrl={accountUrl}
        scopeGroups={scopes.data === undefined ? undefined : grantableScopes(scopes.data, fleetScopes)}
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
        state={promptState}
        prompt={issued?.prompt ?? undefined}
        crewLines={issued?.crewLines ?? undefined}
        error={getStartingPrompt.error?.message}
        isOpen={isPromptOpen && commission.data !== undefined}
        onOpenChange={(isNowOpen) => {
          if (!isNowOpen) {
            setIsPromptOpen(false);
            commission.reset();
            getStartingPrompt.reset();
          }
        }}
        onConfirm={() => {
          if (commission.data !== undefined) {
            getStartingPrompt.mutate({ shipId: commission.data.shipId });
          }
        }}
      />
    </>
  );
}
