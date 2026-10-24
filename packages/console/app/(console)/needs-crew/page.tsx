'use client';

import { FleetSegments } from '../../../components/molecules/fleet-segments';
import { ComposeMessage } from '../../../features/compose/organisms/compose-message';
import { useNeedsCrewPages } from '../../../features/needs-crew/hooks/needs-crew-pages';
import { NeedsCrewAction } from '../../../features/needs-crew/state/needs-crew-action';
import { ShipActions } from '../../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../../features/squadrons/organisms/get-new-crew-line';
import { NeedsCrewList } from '../../../features/needs-crew/ui/organisms/needs-crew-list';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
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
  const pluginNav = usePluginNav();
  const { hasTrierarchs } = pluginNav;
  const list = useNeedsCrewPages({ hasTrierarchs });
  useSignInWhenSessionEnds([attention.error, liveFleet.error, list.error]);

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
        ships={list.items}
        more={{ hasMore: list.hasMore, isLoading: list.isLoadingMore, isFailed: list.isLoadMoreFailed, onLoad: list.loadMore }}
        hasTrierarchs={hasTrierarchs}
        error={list.isFailed ? (list.error instanceof Error ? list.error.message : String(list.error)) : undefined}
        onRetry={list.retry}
        actionOf={(ship) => (hasTrierarchs ? <NeedsCrewAction ship={ship} /> : <ShipActions ship={ship} layout="next" compose={ComposeMessage} crewLineFlow={NewCrewLineFlow} />)}
        now={now}
      />
    </ListPage>
  );
}
