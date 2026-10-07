'use client';

import { use, useState } from 'react';

import { ComposeMessage } from '../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../components/organisms/console-commands';
import { ConsoleGuide } from '../../../components/organisms/console-guide';
import { ConsoleNotices } from '../../../components/organisms/console-notices';
import { MachineDetail } from '../../../components/organisms/machine-detail';
import { MachineList } from '../../../components/organisms/machine-list';
import { DetailLayout } from '../../../components/templates/detail-layout';
import { useAccess } from '../../../lib/access';
import { useAccountMenu } from '../../../lib/account';
import { useFleetSnapshot, useLabelContext } from '../../../lib/fleet';
import { chipsOf } from '../../../lib/labels';
import { useOpenInboxCount } from '../../../lib/inbox';
import { useLiveFleet } from '../../../lib/live-fleet';
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
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const machine = machines.data?.find((each) => each.shipId === shipId);
  const ships = fleet.data ?? [];
  const spots = machine === undefined ? [] : spotsOf(machine, ships);
  const trierarchShip = ships.find((ship) => ship.id === shipId);
  // Each ship's workspace sits in its crew request's settings, which only its page read answers.
  const shipPages = useShips(spots.map((spot) => spot.shipId));
  const settingsByShip = new Map([...shipPages].map(([id, ship]) => [id, ship.crewRequest?.settings]));

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
