'use client';

import { FleetSegments } from '../../../components/molecules/fleet-segments';
import { ComposeMessage } from '../../../features/compose/organisms/compose-message';
import { NeedsCrewAction } from '../../../features/needs-crew/organisms/needs-crew-action';
import { ShipActions } from '../../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../../features/squadrons/organisms/get-new-crew-line';
import { NeedsCrewList } from '../../../features/needs-crew/organisms/needs-crew-list';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useFleetSnapshot } from '../../../lib/fleet';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { needsCrew } from '../../../lib/needs-crew';
import { useNow } from '../../../lib/now';
import { usePluginNav } from '../../../lib/plugin-nav';
import { useSignInWhenSessionEnds } from '../../../lib/session';

/**
 * Needs crew (#245): the operator's to-do of crew requests. Without the
 * trierarch plugin, the ships to crew by hand; with it, the requests that
 * are not running. On phone it is the Fleet tab's second view.
 */
export default function NeedsCrewPage() {
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const fleet = useFleetSnapshot();
  const pluginNav = usePluginNav();
  useSignInWhenSessionEnds([attention.error, liveFleet.error, fleet.error]);
  const { hasTrierarchs } = pluginNav;

  return (
    <ListPage
      {...frame}
      title="Needs crew"
      description={
        hasTrierarchs
          ? 'Ships with a crew request that are not running. Trierarchs crew them; you step in when one crashes or waits for room.'
          : 'Ships you asked to keep crewed that have no crew. Crew each one by hand; crewing it fulfils the request.'
      }
      live={liveFleet.live}
      toolbar={<FleetSegments active="needs-crew" needsCrewCount={pluginNav.needsCrewCount} />}
    >
      <NeedsCrewList
        ships={fleet.data === undefined ? undefined : needsCrew(fleet.data, { hasTrierarchs })}
        hasTrierarchs={hasTrierarchs}
        error={fleet.isError ? fleet.error.message : undefined}
        onRetry={() => {
          void fleet.refetch();
        }}
        actionOf={(ship) => (hasTrierarchs ? <NeedsCrewAction ship={ship} /> : <ShipActions ship={ship} layout="next" compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} />)}
        now={now}
      />
    </ListPage>
  );
}
