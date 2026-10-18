'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { Network } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '../../../components/atoms/button';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { BuiltInNetworkRules } from '../../../features/network/ui/organisms/built-in-network-rules';
import { DeclaredNetworkRules } from '../../../features/network/ui/organisms/declared-network-rules';
import { FleetReachGraph } from '../../../features/network/ui/organisms/fleet-reach-graph';
import { NetworkDeclarationForm } from '../../../features/network/ui/organisms/network-declaration-form';
import { NetworkRulesEditor } from '../../../features/network/ui/organisms/network-rules-editor';
import { ReachRefusalLog } from '../../../features/network/ui/organisms/reach-refusal-log';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useAccess } from '../../../lib/access';
import { useConsoleConstants } from '../../../lib/console-constants';
import { useFleetSnapshot, useLabelContext } from '../../../lib/fleet';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { declarationNote } from '../../../features/network/services/network-declaration';
import { supplyNote } from '../../../lib/network-rules';
import { useHasNetwork, useNetwork, useSaveNetworkDeclaration, useSaveNetworkRules } from '../../../lib/networking-plugin';
import { useNow } from '../../../lib/now';
import { usePluginNav } from '../../../lib/plugin-nav';
import { useBuiltInRules, useSetViewerRead } from '../../../features/network/hooks/built-in-rules';
import { builtInRowsOf } from '../../../features/network/services/built-in-rules';
import { useDeclaredNetworkRules } from '../../../features/network/hooks/declared-rules';
import { declaredRulesOf } from '../../../features/network/services/declared-rules';
import { networkPathOf, useShipReach } from '../../../features/network/hooks/reach';
import { graphShipsOf } from '../../../features/network/services/reach-graph';
import { useReachRefusals } from '../../../features/network/hooks/reach-refusals';
import { useSignInWhenSessionEnds } from '../../../lib/session';

const DESCRIPTION = 'Who may send to, read or manage whom. The networking plugin supplies these rules to the fleet, which checks them on every send. Only argo sees this page.';

/**
 * Network (#260; decisions 0034 to 0036): the networking plugin's page,
 * argo's alone while the plugin is connected. The built-in rules first, then the rules, all-to-all until
 * argo sets some, the rules plugins declared apart and read-only (#573),
 * what the plugin declares for while it does not respond,
 * and the fleet graph showing which ships a picked ship reaches, the pick in
 * the URL (page.tsx), and the log of the sends the rules refused. Without the plugin connected, or for a session without
 * fleet:network, it says where to go instead.
 */
export function NetworkPageFor({ pickedShipId }: { pickedShipId?: ShipId }) {
  const router = useRouter();
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const hasNetwork = useHasNetwork();
  const network = useNetwork();
  const context = useLabelContext();
  const fleet = useFleetSnapshot();
  const reach = useShipReach(hasNetwork ? pickedShipId : undefined);
  const refusals = useReachRefusals(hasNetwork);
  const declared = useDeclaredNetworkRules(hasNetwork);
  const builtIns = useBuiltInRules(hasNetwork);
  const viewerRead = useSetViewerRead();
  const saveRules = useSaveNetworkRules();
  const saveDeclaration = useSaveNetworkDeclaration();
  const { networkRulesMax, shipLabelsMax, whileUnavailable, notRespondingAfterMinSeconds, notRespondingAfterMaxSeconds } = useConsoleConstants();
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
        <BuiltInNetworkRules
          rows={builtIns.data === undefined ? undefined : builtInRowsOf(builtIns.data)}
          error={builtIns.error?.message}
          onRetry={() => {
            void builtIns.refetch();
          }}
          isTurning={viewerRead.isPending}
          turnError={viewerRead.error}
          onViewerReadChange={viewerRead.setViewerRead}
        />
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
        <DeclaredNetworkRules
          declared={declared.data === undefined ? undefined : declaredRulesOf(declared.data, fleet.data)}
          error={declared.error?.message}
          onRetry={() => {
            void declared.refetch();
          }}
          context={context}
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
          reachableShipIds={reach.data}
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
    <ListPage
      {...frame}
      title="Network"
      description={DESCRIPTION}
      live={liveFleet.live}
    >
      {content}
    </ListPage>
  );
}
