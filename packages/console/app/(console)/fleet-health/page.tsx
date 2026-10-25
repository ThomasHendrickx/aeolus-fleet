'use client';

import type { ListedShip } from '@aeolus-fleet/common';

import { ListPage } from '../../../components/organisms/list-page';
import { HealthContainer } from '../../../features/health/state/health-container';
import { SilentMembers } from '../../../features/health/ui/organisms/silent-members';
import { GetNewCrewLine } from '../../../features/squadrons/state/get-new-crew-line';
import { MachineLiveness } from '../../../features/trierarchs/ui/organisms/machine-card';
import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useStuckSummary } from '../../../lib/fleet-health';
import { useListedShips } from '../../../lib/listed-ships';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useShips } from '../../../lib/ship';
import { useSquadrons } from '../../../lib/squadrons-api';
import { silentMembers } from '../../../lib/squadrons-view';

/**
 * Health, live (decision 0042): whether delivery works, where deliveries
 * are stuck and why, with one next step each, then the machines and, with
 * squadrons on, the silent members. Without a session it sends the operator
 * to sign in.
 */
export default function FleetHealthPage() {
  const now = useNow();
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();
  const summary = useStuckSummary();
  const access = useAccess();
  const squadrons = useSquadrons();
  const silent = silentMembers(squadrons.data ?? []);
  const silentShips = useShips(silent.map(({ member }) => member.shipId));
  const shipsById = useListedShips(silent.map(({ member }) => member.shipId)) ?? new Map<string, ListedShip>();
  useSignInWhenSessionEnds([summary.error, liveFleet.error]);

  return (
    <ListPage {...frame} title="Health" description="Where deliveries wait, since when, and what lets them move." live={liveFleet.live}>
      <HealthContainer renderLiveness={(machine) => <MachineLiveness machine={machine} now={now} />}>
        {silent.length > 0 ? (
          <section aria-labelledby="health-silent" className="flex flex-col gap-2">
            <h2 id="health-silent" className="text-section font-semibold text-foreground">
              Silent members ({silent.length})
            </h2>
            <SilentMembers
              members={silent}
              ships={shipsById}
              now={now}
              renderAction={
                access.canManage
                  ? ({ squadronId, member }) => (
                      <GetNewCrewLine squadronId={squadronId} member={member} ship={silentShips.get(member.shipId)} isPrimary testId="silent-member-new-crew-line" />
                    )
                  : undefined
              }
            />
            <p className="text-meta text-muted-foreground">
              A member is silent after 3 missed check-ins; only you can start its new session. Late members and blocked reports stay on their squadron page.
            </p>
          </section>
        ) : null}
      </HealthContainer>
    </ListPage>
  );
}
