'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { useFleetSnapshot, useGetStartingPrompt, useReleaseShip } from '../../lib/fleet';
import type { FleetView } from '../../lib/fleet-filter';
import { useNow } from '../../lib/now';
import { ShipActions } from '../molecules/ship-actions';
import { StartingPromptBlock } from '../molecules/starting-prompt-block';
import { FleetTable } from './fleet-table';

/** A section error where the action was taken: what failed, nothing changed (follows InlineError, section). */
function SectionError({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-tone-attention-fg">
      <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
      <p role="alert">{children}</p>
    </div>
  );
}

/**
 * The fleet overview: the live snapshot in FleetTable, with each ship's
 * actions, a new starting prompt shown once, and what failed when an action
 * did. Search and filters come from the page, which keeps them in the URL.
 */
export function FleetOverview({
  view,
  onViewChange,
  newShipIds,
}: {
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ships commissioned since the page opened: their rows get the highlight. */
  newShipIds: ReadonlySet<ShipId>;
}) {
  const fleet = useFleetSnapshot();
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();
  const now = useNow();

  const issued = getStartingPrompt.data;
  const issuedFor = issued && fleet.data?.find((ship) => ship.id === issued.shipId);

  return (
    <section aria-label="Fleet" className="flex flex-col gap-3">
      <FleetTable
        ships={fleet.data ?? []}
        view={view}
        onViewChange={onViewChange}
        state={fleet.isPending ? 'loading' : fleet.isError ? 'error' : 'ready'}
        error={{
          detail: fleet.error?.message,
          onRetry: () => {
            void fleet.refetch();
          },
        }}
        highlightedShipIds={newShipIds}
        now={now}
        renderRowActions={(ship) => (
          <ShipActions
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
        )}
      />
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
