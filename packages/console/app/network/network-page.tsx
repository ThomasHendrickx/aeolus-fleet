'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { Network } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../../components/atoms/button';
import { EmptyState } from '../../components/molecules/empty-state';
import { InlineError } from '../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../components/molecules/loading-skeleton';
import { ComposeMessage } from '../../features/compose/organisms/compose-message';
import { ConsoleCommands } from '../../features/commands/organisms/console-commands';
import { ConsoleGuide } from '../../features/guide/organisms/console-guide';
import { ConsoleNotices } from '../../features/notices/organisms/console-notices';
import { FleetReachGraph } from '../../features/network/organisms/fleet-reach-graph';
import { NetworkDeclarationForm } from '../../features/network/organisms/network-declaration-form';
import { NetworkRulesEditor } from '../../features/network/organisms/network-rules-editor';
import { ReachRefusalLog } from '../../features/network/organisms/reach-refusal-log';
import { ListLayout } from '../../components/templates/list-layout';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useConsoleConstants } from '../../lib/console-constants';
import { useFleetSnapshot, useLabelContext } from '../../lib/fleet';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { declarationNote } from '../../features/network/lib/network-declaration';
import { supplyNote } from '../../lib/network-rules';
import { useHasNetwork, useNetwork, useSaveNetworkDeclaration, useSaveNetworkRules } from '../../lib/networking-plugin';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';
import { networkPathOf, useShipReach } from '../../features/network/hooks/reach';
import { graphShipsOf } from '../../features/network/lib/reach-graph';
import { useReachRefusals } from '../../features/network/hooks/reach-refusals';
import { useSignInWhenSessionEnds } from '../../lib/session';

const DESCRIPTION = 'Who may message whom. The networking plugin supplies these rules to the fleet, which checks them on every send. Only argo sees this page.';

/**
 * Network (#260; decisions 0034 to 0036): the networking plugin's page,
 * argo's alone while the plugin is connected. The rules, all-to-all until
 * argo sets some, what the plugin declares for while it does not respond,
 * and the fleet graph showing which ships a picked ship reaches, the pick in
 * the URL (page.tsx), and the log of the sends the rules refused. Without the plugin connected, or for a session without
 * fleet:network, it says where to go instead.
 */
export function NetworkPageFor({ pickedShipId }: { pickedShipId?: ShipId }) {
  const router = useRouter();
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const hasNetwork = useHasNetwork();
  const network = useNetwork();
  const context = useLabelContext();
  const fleet = useFleetSnapshot();
  const reach = useShipReach(hasNetwork ? pickedShipId : undefined);
  const refusals = useReachRefusals(hasNetwork);
  const saveRules = useSaveNetworkRules();
  const saveDeclaration = useSaveNetworkDeclaration();
  const { networkRulesMax, shipLabelsMax, whileUnavailable, notRespondingAfterMinSeconds, notRespondingAfterMaxSeconds } = useConsoleConstants();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  let content;
  if (!hasNetwork) {
    content = (
      <EmptyState
        icon={<Network aria-hidden />}
        title={access.canEditNetwork ? 'The networking plugin is not connected' : 'Only argo sees the network rules'}
        description={access.canEditNetwork ? 'Connect it in Settings. Until it supplies rules, every ship may message every ship.' : undefined}
        action={
          access.canEditNetwork && pluginNav.hasSettings ? (
            <Button nativeButton={false} render={<Link href="/settings" />} data-testid="network-open-settings">
              Open Settings
            </Button>
          ) : undefined
        }
      />
    );
  } else if (network.isError) {
    content = (
      <InlineError
        title="Couldn’t read the network"
        description={network.error.message}
        onRetry={() => {
          void network.refetch();
        }}
      />
    );
  } else if (network.data === undefined || context === undefined || fleet.data === undefined) {
    content = <LoadingSkeleton variant="detail" rows={4} label="Loading the network" />;
  } else {
    content = (
      <>
        <NetworkRulesEditor
          key={JSON.stringify(network.data.rules)}
          rules={network.data.rules}
          context={context}
          limits={{ rulesMax: networkRulesMax, selectorMax: shipLabelsMax }}
          isSaving={saveRules.isPending}
          saveError={saveRules.error?.message}
          savedNote={saveRules.data === undefined ? undefined : supplyNote(saveRules.data.supply)}
          onSave={(rules) => {
            saveRules.mutate(rules);
          }}
        />
        <NetworkDeclarationForm
          key={JSON.stringify(network.data.declaration)}
          declaration={network.data.declaration}
          options={whileUnavailable}
          bounds={{ min: notRespondingAfterMinSeconds, max: notRespondingAfterMaxSeconds }}
          isSaving={saveDeclaration.isPending}
          saveError={saveDeclaration.error?.message}
          savedNote={saveDeclaration.data === undefined ? undefined : declarationNote(saveDeclaration.data.supply)}
          onSave={(declaration) => {
            saveDeclaration.mutate(declaration);
          }}
        />
        <FleetReachGraph
          ships={graphShipsOf(fleet.data)}
          pickedShipId={pickedShipId}
          reachableShipIds={reach.data?.reachableShipIds}
          reachError={reach.error?.message}
          onPick={(shipId) => {
            router.replace(networkPathOf(shipId), { scroll: false });
          }}
          onRetry={() => {
            void reach.refetch();
          }}
        />
        <ReachRefusalLog
          refusals={refusals.data}
          error={refusals.error?.message}
          onRetry={() => {
            void refusals.refetch();
          }}
          context={context}
          now={now}
        />
      </>
    );
  }

  return (
    <ListLayout
      title="Network"
      description={DESCRIPTION}
      live={liveFleet.live}
      nav={{ active: 'network', inboxCount, attentionCount, ...pluginNav }}
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
    >
      {content}
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
