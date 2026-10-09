'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/atoms/badge';
import { Button } from '../../components/atoms/button';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { ConsoleGuide } from '../../components/organisms/console-guide';
import { ConsoleNotices } from '../../components/organisms/console-notices';
import { MachineList } from '../../components/organisms/machine-list';
import { ListLayout } from '../../components/templates/list-layout';
import { lazyDialog } from '../../lib/lazy-dialog';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useFleetSnapshot } from '../../lib/fleet';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useJoinMachine, useMachines, useTrierarchPluginConnection, useTrierarchPluginVersion } from '../../lib/trierarch-plugin';

// Dialogs load when first opened, not with the page.
const JoinMachineDialog = lazyDialog(() => import('../../components/organisms/join-machine-dialog').then((module) => module.JoinMachineDialog), (props) => props.isOpen);

/**
 * Trierarchs (#245): the machines that run sessions for crew requests, each
 * with its capacity and what it offers, and Join a machine. Without the
 * trierarch plugin it says what the plugin does and how to set it up. The
 * version the plugin runs sits beside the title (canvas TpMachines).
 */
export default function TrierarchsPage() {
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const fleet = useFleetSnapshot();
  const connection = useTrierarchPluginConnection();
  const machines = useMachines();
  const pluginVersion = useTrierarchPluginVersion();
  const join = useJoinMachine();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isJoining, setIsJoining] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const canJoin = access.canManage && connection === 'connected';
  const openJoin = () => {
    join.reset();
    setIsJoining(true);
  };

  return (
    <ListLayout
      title="Trierarchs"
      titleMeta={
        pluginVersion === undefined ? undefined : (
          <Badge variant="outline" data-testid="trierarchs-plugin-version">
            trierarch plugin {pluginVersion}
          </Badge>
        )
      }
      description={connection === 'none' ? 'Not set up.' : 'Machines that run sessions for crew requests. The plugin picks a trierarch for each request.'}
      live={liveFleet.live}
      nav={{ active: 'trierarchs', inboxCount, attentionCount, ...pluginNav }}
      primaryAction={
        canJoin ? (
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={openJoin} data-testid="trierarchs-join">
            Join a machine
          </Button>
        ) : undefined
      }
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
    >
      <MachineList
        connection={connection}
        machines={machines.data}
        ships={fleet.data ?? []}
        error={machines.isError ? machines.error.message : undefined}
        onRetry={() => {
          void machines.refetch();
        }}
        onJoin={canJoin ? openJoin : undefined}
        now={now}
      />
      {canJoin && (
        <JoinMachineDialog
          activeNames={(fleet.data ?? []).filter((ship) => ship.status !== 'retired').map((ship) => ship.name)}
          isOpen={isJoining}
          onOpenChange={(isOpen) => {
            setIsJoining(isOpen);
            if (!isOpen) {
              // What was shown once is gone with the dialog.
              join.reset();
            }
          }}
          isPending={join.isPending}
          error={join.error?.message}
          joined={join.data}
          onSubmit={(name) => {
            join.mutate(name);
          }}
        />
      )}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}
