'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { use, useState } from 'react';

import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { ConsoleGuide } from '../../../components/organisms/console-guide';
import { ConsoleNotices } from '../../../components/organisms/console-notices';
import { ClearWorktreeDialog, type WorktreeToClear } from '../../../components/organisms/clear-worktree-dialog';
import { MachineDetail } from '../../../components/organisms/machine-detail';
import { MachineList } from '../../../components/organisms/machine-list';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { useAccess } from '../../../lib/access';
import { useAccountMenu } from '../../../lib/account';
import { useClearRequests, useClearWorktree } from '../../../lib/clear-requests';
import { useFleetSnapshot, useLabelContext } from '../../../lib/fleet';
import { chipsOf } from '../../../lib/labels';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useCrewSettings } from '../../../lib/crew-settings';
import { spotsOf, withWorkspaces } from '../../../lib/machines';
import { useAttentionCount, useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { usePluginNav } from '../../../lib/plugin-nav';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useShips } from '../../../lib/ship';
import { useMachines, useTrierarchPluginConnection } from '../../../lib/trierarch-plugin';

/** One machine of the Trierarchs section, by its trierarch's ship id; without a connected plugin, why not. */
export default function MachinePage({ params }: { params: Promise<{ shipId: string }> }) {
  const { shipId } = use(params);
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const fleet = useFleetSnapshot();
  const labelContext = useLabelContext();
  const connection = useTrierarchPluginConnection();
  const machines = useMachines();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [toClear, setToClear] = useState<(WorktreeToClear & { trierarchShipId: ShipId; shipId: ShipId; repository: string }) | undefined>(undefined);
  const clearRequests = useClearRequests();
  const clearWorktree = useClearWorktree();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const machine = machines.data?.find((each) => each.shipId === shipId);
  const ships = fleet.data ?? [];
  const spots = machine === undefined ? [] : spotsOf(machine, ships);
  const trierarchShip = ships.find((ship) => ship.id === shipId);
  // Each ship's workspace sits in its crew request's settings, which only its page read answers.
  const shipPages = useShips(spots.map((spot) => spot.shipId));
  // Parsed on the web app's server: the fleet stores them without meaning.
  const read = [...shipPages].flatMap(([id, ship]) => (ship.crewRequest === null ? [] : [{ id, settings: ship.crewRequest.settings }]));
  const parsed = useCrewSettings(read.map((each) => each.settings));
  const settingsByShip = new Map(read.map((each, index) => [each.id, parsed?.[index] ?? null]));

  return (
    <DetailLayout
      title={machine?.name ?? 'Machine'}
      parents={[{ href: '/trierarchs', label: 'Trierarchs' }]}
      live={liveFleet.live}
      nav={{ active: 'trierarchs', inboxCount, attentionCount, ...pluginNav }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
      header={
        connection === 'connected' && !machines.isError ? (
          <MachineDetail
            machine={machine}
            state={machines.data === undefined ? 'loading' : machine === undefined ? 'not-found' : 'ready'}
            spots={withWorkspaces(spots, settingsByShip)}
            location={trierarchShip?.location ?? null}
            {...(labelContext === undefined || trierarchShip === undefined ? {} : { labels: chipsOf(trierarchShip, labelContext) })}
            now={now}
            shipNames={new Map(ships.map((ship) => [ship.id, ship.name]))}
            clearRequests={clearRequests.data ?? []}
            {...(access.canManage && machine !== undefined
              ? {
                  onClearKept: (kept: { shipId: ShipId; repository: string; shipName: string }) => {
                    clearWorktree.reset();
                    setToClear({ ...kept, trierarchShipId: machine.shipId, machineName: machine.name });
                  },
                }
              : {})}
          />
        ) : (
          <MachineList
            connection={connection}
            machines={machines.data}
            ships={ships}
            error={machines.isError ? machines.error.message : undefined}
            onRetry={() => {
              void machines.refetch();
            }}
            now={now}
          />
        )
      }
    >
      <ClearWorktreeDialog
        worktree={toClear}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setToClear(undefined);
          }
        }}
        isPending={clearWorktree.isPending}
        {...(clearWorktree.error === null ? {} : { error: clearWorktree.error.message })}
        onClear={() => {
          if (toClear !== undefined) {
            clearWorktree.mutate(
              { trierarchShipId: toClear.trierarchShipId, shipId: toClear.shipId, repository: toClear.repository },
              {
                onSuccess: () => {
                  setToClear(undefined);
                },
              },
            );
          }
        }}
      />
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </DetailLayout>
  );
}
