import { Server } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '../../../../components/atoms/button';

/** A machine as the Health page lists it: its trierarch ship, and how many ships it crews. */
export interface HealthMachine {
  id: string;
  name: string;
  ships: number;
}

interface MachinesPanelProps {
  machines: readonly HealthMachine[];
  /** How many deliveries are stuck on each machine's ships, by machine id. */
  stuckByMachine: ReadonlyMap<string, number>;
  /** Whether the machine's trierarch answers, as the Trierarchs page shows it. */
  renderLiveness: (machine: HealthMachine) => ReactNode;
}

/**
 * The machines last on Health (mock-up A): each one's trierarch, whether it
 * answers, how many ships it crews, and how many deliveries are stuck on
 * them, with the machine to open when any are.
 */
export function MachinesPanel({ machines, stuckByMachine, renderLiveness }: MachinesPanelProps) {
  return (
    <section aria-labelledby="health-machines" data-testid="health-machines" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm max-sm:rounded-xl">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="health-machines" className="text-section font-semibold text-foreground">
          Machines
        </h2>
        <p className="text-meta text-muted-foreground">Each machine runs a trierarch that crews ships.</p>
      </header>
      <ul className="flex flex-col divide-y divide-border">
        {machines.map((machine) => {
          const stuck = stuckByMachine.get(machine.id) ?? 0;
          return (
            <li key={machine.id} data-testid="health-machine" className="flex items-center gap-4 py-3 first:pt-0 last:pb-0 max-sm:flex-wrap max-sm:gap-2">
              <span className="inline-flex min-w-40 items-center gap-2 font-medium text-foreground">
                <Server aria-hidden className="size-(--size-icon) text-muted-foreground" />
                {machine.name}
              </span>
              <span className="min-w-0 flex-1">{renderLiveness(machine)}</span>
              <span className="text-meta text-muted-foreground">
                {machine.ships} {machine.ships === 1 ? 'ship' : 'ships'}
                {stuck > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-foreground">
                      {stuck} {stuck === 1 ? 'delivery' : 'deliveries'} stuck on its ships
                    </span>
                  </>
                )}
              </span>
              {stuck > 0 && (
                <Button variant="secondary" size="sm" nativeButton={false} render={<Link href={`/trierarchs/${machine.id}`} />} className="max-sm:h-(--size-control-touch) max-sm:w-full">
                  Open machine
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
