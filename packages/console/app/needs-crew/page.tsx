'use client';

import { useState } from 'react';

import { FleetSegments } from '../../components/molecules/fleet-segments';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { ConsoleCommands } from '../../features/commands/organisms/console-commands';
import { ConsoleGuide } from '../../features/guide/organisms/console-guide';
import { ConsoleNotices } from '../../features/notices/organisms/console-notices';
import { NeedsCrewAction } from '../../features/needs-crew/organisms/needs-crew-action';
import { ShipActions } from '../../features/ship-actions/organisms/ship-actions';
import { NewCrewLineFlow } from '../../features/squadrons/organisms/get-new-crew-line';
import { NeedsCrewList } from '../../features/needs-crew/organisms/needs-crew-list';
import { ListLayout } from '../../components/templates/list-layout';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useFleetSnapshot } from '../../lib/fleet';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { needsCrew } from '../../lib/needs-crew';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';
import { useSignInWhenSessionEnds } from '../../lib/session';

/**
 * Needs crew (#245): the operator's to-do of crew requests. Without the
 * trierarch plugin, the ships to crew by hand; with it, the requests that
 * are not running. On phone it is the Fleet tab's second view.
 */
export default function NeedsCrewPage() {
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const fleet = useFleetSnapshot();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error, fleet.error]);
  const { hasTrierarchs } = pluginNav;

  return (
    <ListLayout
      title="Needs crew"
      description={
        hasTrierarchs
          ? 'Ships with a crew request that are not running. Trierarchs crew them; you step in when one crashes or waits for room.'
          : 'Ships you asked to keep crewed that have no crew. Crew each one by hand; crewing it fulfils the request.'
      }
      live={liveFleet.live}
      nav={{ active: 'needs-crew', inboxCount, attentionCount, ...pluginNav }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
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
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </ListLayout>
  );
}
