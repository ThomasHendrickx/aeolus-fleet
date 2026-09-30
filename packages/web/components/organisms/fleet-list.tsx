'use client';

import { useFleetSnapshot, useGetStartingPrompt, useReleaseShip } from '../../lib/fleet';
import { ShipRow } from '../molecules/ship-row';
import { StartingPromptBlock } from '../molecules/starting-prompt-block';

/**
 * The fleet snapshot: every ship with its type, status, where the session
 * crewing it runs and its prompt state, a new starting prompt for a ship
 * awaiting crew, shown once, and Release for a crewed ship.
 */
export function FleetList() {
  const fleet = useFleetSnapshot();
  const getStartingPrompt = useGetStartingPrompt();
  const releaseShip = useReleaseShip();

  if (fleet.isPending) {
    return <p>Loading the fleet...</p>;
  }
  if (fleet.isError) {
    return <p role="alert">The fleet could not be loaded: {fleet.error.message}</p>;
  }

  const issued = getStartingPrompt.data;
  const issuedFor = issued && fleet.data.find((ship) => ship.id === issued.shipId);

  return (
    <section aria-labelledby="fleet-heading">
      <h2 id="fleet-heading">Fleet</h2>
      <table data-testid="fleet-list">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Location</th>
            <th scope="col">Starting prompt</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
      {getStartingPrompt.isError ? (
        <p role="alert">No new starting prompt: {getStartingPrompt.error.message}</p>
      ) : null}
      {releaseShip.isError ? <p role="alert">The ship was not released: {releaseShip.error.message}</p> : null}
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
