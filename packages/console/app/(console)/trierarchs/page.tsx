'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../../components/atoms/badge';
import { Button } from '@aeolus-fleet/common/header';
import { useAssignedShips } from '../../../features/trierarchs/hooks/assigned-ships';
import { ModelsContainer } from '../../../features/trierarchs/state/models-container';
import { MachineList } from '../../../features/trierarchs/ui/organisms/machine-list';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useAccess } from '../../../lib/access';
import { useListedShips } from '../../../lib/listed-ships';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useIsShipNameTaken } from '../../../lib/ship-name-taken';
import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { useJoinMachine, useMachines, useNewSetupLine, useTrierarchPluginConnection, useTrierarchPluginVersion } from '../../../lib/trierarch-plugin';

// Dialogs load when first opened, not with the page.
const JoinMachineDialog = lazyDialog(() => import('../../../features/trierarchs/ui/organisms/join-machine-dialog').then((module) => module.JoinMachineDialog), (props) => props.isOpen);
const NewSetupLineDialog = lazyDialog(() => import('../../../features/trierarchs/ui/organisms/new-setup-line-dialog').then((module) => module.NewSetupLineDialog), (props) => props.isOpen);

/**
 * Trierarchs (#245): the machines that run sessions for crew requests, each
 * with its capacity and what it offers, and Join a machine; on each card, a
 * new setup line for a lost one (#1239). Without the
 * trierarch plugin it says what the plugin does and how to set it up. The
 * version the plugin runs sits beside the title (canvas TpMachines). Below
 * them, the fleet's enabled models (model governance, M7).
 */
export default function TrierarchsPage() {
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const connection = useTrierarchPluginConnection();
  const machines = useMachines();
  const machineShipIds = machines.data?.map((machine) => machine.shipId);
  // The ships the machines crew, for their spots, and the machines' own ships, for where each runs.
  const assigned = useAssignedShips(machineShipIds) ?? [];
  const machineShips = useListedShips(machineShipIds ?? []);
  const pluginVersion = useTrierarchPluginVersion();
  const join = useJoinMachine();
  const access = useAccess();
  const [isJoining, setIsJoining] = useState(false);
  const [typedName, setTypedName] = useState('');
  const isNameTaken = useIsShipNameTaken(isJoining ? typedName : '');
  const newLine = useNewSetupLine();
  const [lineFor, setLineFor] = useState<Pick<Machine, 'shipId' | 'name'> | undefined>(undefined);
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
        ships={[...assigned, ...(machineShips?.values() ?? [])]}
        error={machines.isError ? machines.error.message : undefined}
        onRetry={() => {
          void machines.refetch();
        }}
        onJoin={canJoin ? openJoin : undefined}
        onNewSetupLine={
          canJoin
            ? (machine) => {
                newLine.reset();
                setLineFor(machine);
              }
            : undefined
        }
        now={now}
      />
      {connection === 'connected' && <ModelsContainer />}
      {canJoin && (
        <JoinMachineDialog
          takenNames={isNameTaken === true ? [typedName] : []}
          onNameChange={setTypedName}
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
      {canJoin && lineFor !== undefined && (
        <NewSetupLineDialog
          name={lineFor.name}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              // What was shown once is gone with the dialog.
              setLineFor(undefined);
              newLine.reset();
            }
          }}
          isPending={newLine.isPending}
          error={newLine.error?.message}
          setupLine={newLine.data?.setupLine}
          onConfirm={() => {
            newLine.mutate(lineFor.shipId);
          }}
        />
      )}
    </ListPage>
  );
}
