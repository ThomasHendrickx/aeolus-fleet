'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../../components/atoms/badge';
import { Button } from '../../../components/atoms/button';
import { MachineList } from '../../../features/trierarchs/organisms/machine-list';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useAccess } from '../../../lib/access';
import { useFleetSnapshot } from '../../../lib/fleet';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useJoinMachine, useMachines, useTrierarchPluginConnection, useTrierarchPluginVersion } from '../../../lib/trierarch-plugin';

// Dialogs load when first opened, not with the page.
const JoinMachineDialog = lazyDialog(() => import('../../../features/trierarchs/organisms/join-machine-dialog').then((module) => module.JoinMachineDialog), (props) => props.isOpen);

/**
 * Trierarchs (#245): the machines that run sessions for crew requests, each
 * with its capacity and what it offers, and Join a machine. Without the
 * trierarch plugin it says what the plugin does and how to set it up. The
 * version the plugin runs sits beside the title (canvas TpMachines).
 */
export default function TrierarchsPage() {
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const fleet = useFleetSnapshot();
  const connection = useTrierarchPluginConnection();
  const machines = useMachines();
  const pluginVersion = useTrierarchPluginVersion();
  const join = useJoinMachine();
  const access = useAccess();
  const [isJoining, setIsJoining] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const canJoin = access.canManage && connection === 'connected';
  const openJoin = () => {
    join.reset();
    setIsJoining(true);
  };

  return (
    <ListPage
      {...frame}
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
      primaryAction={
        canJoin ? (
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={openJoin} data-testid="trierarchs-join">
            Join a machine
          </Button>
        ) : undefined
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
    </ListPage>
  );
}
