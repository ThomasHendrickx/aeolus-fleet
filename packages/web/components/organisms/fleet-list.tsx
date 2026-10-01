'use client';

import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { useFleetSnapshot, useGetStartingPrompt, useReleaseShip } from '../../lib/fleet';
import { Skeleton } from '../atoms/skeleton';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../atoms/table';
import { ShipRow } from '../molecules/ship-row';
import { StartingPromptBlock } from '../molecules/starting-prompt-block';

/**
 * The fleet snapshot: every ship with its type, status, where the session
 * crewing it runs and its prompt state, a new starting prompt for a ship
 * awaiting crew, shown once, and Release for a crewed ship.
 */
/** A section error where the action was taken: what failed, nothing changed (follows InlineError, section). */
function SectionError({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-tone-attention-fg">
      <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
      <p role="alert">{children}</p>
    </div>
  );
}

const LOADING_ROWS = ['first', 'second', 'third'];

export function FleetList() {
  const fleet = useFleetSnapshot();
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();

  if (fleet.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <span className="sr-only">Loading the fleet...</span>
        {LOADING_ROWS.map((row) => (
          <Skeleton key={row} className="h-(--size-row) w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (fleet.isError) {
    return <SectionError>The fleet could not be loaded: {fleet.error.message}</SectionError>;
  }

  const issued = getStartingPrompt.data;
  const issuedFor = issued && fleet.data.find((ship) => ship.id === issued.shipId);

  return (
    <section aria-labelledby="fleet-heading" className="flex flex-col gap-3">
      <h2 id="fleet-heading" className="text-section font-semibold">
        Fleet
      </h2>
      <Table data-testid="fleet-list">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Name</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Location</TableHead>
            <TableHead scope="col">Starting prompt</TableHead>
            <TableHead scope="col" className="text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fleet.data.map((ship) => (
            <ShipRow
              key={ship.id}
              ship={ship}
              isIssuing={getStartingPrompt.isPending && getStartingPrompt.variables.shipId === ship.id}
              onGetStartingPrompt={() => {
                getStartingPrompt.mutate({ shipId: ship.id });
              }}
              isReleasing={releaseShip.isPending && releaseShip.variables.shipId === ship.id}
              onRelease={() => {
                releaseShip.mutate({ shipId: ship.id });
              }}
            />
          ))}
        </TableBody>
      </Table>
      {getStartingPrompt.isError ? (
        <SectionError>No new starting prompt: {getStartingPrompt.error.message}</SectionError>
      ) : null}
      {releaseShip.isError ? <SectionError>The ship was not released: {releaseShip.error.message}</SectionError> : null}
      {issued ? (
        <StartingPromptBlock
          shipName={issuedFor?.name ?? issued.shipId}
          prompt={issued.prompt}
          onDone={() => {
            getStartingPrompt.reset();
          }}
        />
      ) : null}
    </section>
  );
}
