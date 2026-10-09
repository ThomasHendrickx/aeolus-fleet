import type { ListedShip } from '@aeolus-fleet/common';
import { Plus, ShipWheel, Unplug } from 'lucide-react';
import Link from 'next/link';

import { spotsOf } from '../../lib/machines';
import { SOURCE_URL } from '../../lib/source';
import type { Machine } from '../../lib/trierarch-plugin-schemas';
import { Button } from '../atoms/button';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { MachineCard } from './machine-card';

/** Where setting the trierarch plugin up is described: its README. */
export const TRIERARCH_PLUGIN_SETUP_URL = `${SOURCE_URL}/tree/main/packages/trierarch-plugin#readme`;

interface MachineListProps {
  /** none: not set up or off for this fleet; not-connected: set up, not connected yet; unknown while its connection is read. */
  connection: 'none' | 'unknown' | 'not-connected' | 'connected';
  machines: readonly Machine[] | undefined;
  /** The fleet's ships, for each machine's capacity and location. */
  ships: readonly ListedShip[];
  /** Why the machines could not be read. */
  error?: string;
  onRetry: () => void;
  /** Join a machine, for a session that manages the fleet. */
  onJoin?: () => void;
  now: Date;
}

/**
 * The Trierarchs section's machines (canvas TpMachines, TpOffPage): a card per
 * machine, or why there is none. Not set up is a normal state: crew requests
 * then wait on Needs crew to be crewed by hand.
 */
export function MachineList({ connection, machines, ships, error, onRetry, onJoin, now }: MachineListProps) {
  if (connection === 'none') {
    return (
      <EmptyState
        icon={<ShipWheel aria-hidden />}
        title="The trierarch plugin is not set up for this fleet"
        description="Crew requests work without it: they wait on Needs crew and you crew each ship by hand with its starting prompt. With the plugin, trierarchs on your machines start, restart and stop those sessions for you."
        action={
          <Button
            nativeButton={false}
            render={({ children, ...props }) => (
              <a href={TRIERARCH_PLUGIN_SETUP_URL} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            )}
            data-testid="trierarchs-setup"
          >
            How to set up the trierarch plugin
          </Button>
        }
      />
    );
  }
  if (connection === 'not-connected') {
    return (
      <EmptyState
        icon={<Unplug aria-hidden />}
        title="The trierarch plugin is not connected"
        description="Connect it in Settings; its machines show up here then."
        action={
          <Button nativeButton={false} render={<Link href="/settings" />} data-testid="trierarchs-open-settings">
            Open Settings
          </Button>
        }
      />
    );
  }
  if (error !== undefined) {
    return <InlineError variant="page" title="Couldn’t read the machines" description="Nothing changed." detail={error} onRetry={onRetry} />;
  }
  if (machines === undefined || connection === 'unknown') {
    return <LoadingSkeleton variant="cards" rows={2} label="Loading the machines" />;
  }
  if (machines.length === 0) {
    return (
      <EmptyState
        icon={<ShipWheel aria-hidden />}
        title="No machines yet"
        description="Join a machine: its trierarch then starts sessions there for the crew requests the plugin gives it."
        action={
          onJoin ? (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={onJoin} data-testid="trierarchs-join-empty">
              Join a machine
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="machine-list">
      {machines.map((machine) => (
        <MachineCard key={machine.shipId} machine={machine} spots={spotsOf(machine, ships)} location={ships.find((ship) => ship.id === machine.shipId)?.location ?? null} now={now} />
      ))}
    </div>
  );
}
