'use client';

import type { ShipId } from '@aeolus-fleet/common';
import { Network } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { BuiltInNetworkRules } from '../../../features/network/ui/organisms/built-in-network-rules';
import { DeclaredNetworkRules } from '../../../features/network/ui/organisms/declared-network-rules';
import { FleetReachGraph } from '../../../features/network/ui/organisms/fleet-reach-graph';
import { NetworkRulesApply } from '../../../features/network/ui/organisms/network-rules-apply';
import { NetworkRulesDraftChanges } from '../../../features/network/ui/organisms/network-rules-draft-changes';
import { NetworkRulesEditor } from '../../../features/network/ui/organisms/network-rules-editor';
import { ReachRefusalLog } from '../../../features/network/ui/organisms/reach-refusal-log';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useAccess } from '../../../lib/access';
import { useConsoleConstants } from '../../../lib/console-constants';
import { useFleetSnapshot, useLabelContext } from '../../../lib/fleet';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useApplyNetworkRules, useDiscardNetworkRulesDraft, useNetworkRules, useNetworkRulesDraftChanges, useSaveNetworkRulesDraft } from '../../../features/network/hooks/network-rules';
import { draftChangesOf } from '../../../features/network/services/draft-changes';
import { useNow } from '../../../lib/now';
import { useBuiltInRules, useSetViewerRead } from '../../../features/network/hooks/built-in-rules';
import { builtInRowsOf } from '../../../features/network/services/built-in-rules';
import { useDeclaredNetworkRules } from '../../../features/network/hooks/declared-rules';
import { declaredRulesOf } from '../../../features/network/services/declared-rules';
import { networkPathOf, useShipReach } from '../../../features/network/hooks/reach';
import { graphShipsOf, type ReachAgainst } from '../../../features/network/services/reach-graph';
import { useReachRefusals } from '../../../features/network/hooks/reach-refusals';
import { useSignInWhenSessionEnds } from '../../../lib/session';

const DESCRIPTION = 'Who may send to, read or manage whom. The fleet checks the applied rules on every send; a draft changes nothing until it is applied.';

/**
 * Network (#260; decision 0034), for a session holding fleet:network: the
 * built-in rules first, then the fleet's own rules, all-to-all until rules are
 * applied, edited as a draft, what the draft changes, and the apply apart
 * (decision 0035), the rules ships declared apart and read-only (#573), the
 * fleet graph showing which ships a picked ship reaches, against the applied
 * rules or the draft, the pick and the draft in the URL (page.tsx), and the
 * log of the sends the rules refused. For any other session, it says so.
 */
export function NetworkPageFor({ pickedShipId, against }: { pickedShipId?: ShipId; against: ReachAgainst }) {
  const router = useRouter();
  const now = useNow();
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const access = useAccess();
  const hasNetwork = access.canEditNetwork;
  const network = useNetworkRules(hasNetwork);
  const hasDraft = network.data !== undefined && network.data.draft !== null;
  // Without a draft, the graph shows the applied rules whatever the URL says.
  const reachAgainst = hasDraft ? against : 'applied';
  const draftChanges = useNetworkRulesDraftChanges(hasNetwork && hasDraft);
  const context = useLabelContext();
  const fleet = useFleetSnapshot();
  const reach = useShipReach(hasNetwork ? pickedShipId : undefined, reachAgainst);
  const refusals = useReachRefusals(hasNetwork);
  const declared = useDeclaredNetworkRules(hasNetwork);
  const builtIns = useBuiltInRules(hasNetwork);
  const viewerRead = useSetViewerRead();
  const saveDraft = useSaveNetworkRulesDraft();
  const apply = useApplyNetworkRules();
  const discard = useDiscardNetworkRulesDraft();
  const { networkRulesMax, shipLabelsMax } = useConsoleConstants();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  let content;
  if (!hasNetwork) {
    content = <EmptyState icon={<Network aria-hidden />} title="Only a session holding fleet:network sees the network rules" />;
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
          key={JSON.stringify(network.data.draft ?? network.data.applied)}
          rules={(network.data.draft ?? network.data.applied).rules}
          context={context}
          limits={{ rulesMax: networkRulesMax, selectorMax: shipLabelsMax }}
          isSaving={saveDraft.isPending}
          saveError={saveDraft.error?.message}
          savedNote={saveDraft.data === undefined ? undefined : 'Draft saved. Nothing changes until it is applied.'}
          onSave={(rules) => {
            saveDraft.mutate({ rules });
          }}
        />
        {network.data.draft === null ? null : (
          <NetworkRulesDraftChanges
            changes={draftChanges.data === undefined ? undefined : draftChangesOf(draftChanges.data, fleet.data)}
            error={draftChanges.error?.message}
            onRetry={() => {
              void draftChanges.refetch();
            }}
          />
        )}
        <NetworkRulesApply
          draft={network.data.draft}
          appliedVersion={network.data.applied.version}
          isApplying={apply.isPending}
          applyError={apply.error?.message}
          onApply={() => {
            apply.mutate({ version: network.data.applied.version });
          }}
          isDiscarding={discard.isPending}
          discardError={discard.error?.message}
          onDiscard={() => {
            discard.mutate();
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
        <FleetReachGraph
          ships={graphShipsOf(fleet.data)}
          pickedShipId={pickedShipId}
          reachableShipIds={reach.data}
          reachError={reach.error?.message}
          onPick={(shipId) => {
            router.replace(networkPathOf(shipId, reachAgainst), { scroll: false });
          }}
          against={reachAgainst}
          {...(hasDraft
            ? {
                onAgainstChange: (next: ReachAgainst) => {
                  router.replace(networkPathOf(pickedShipId, next), { scroll: false });
                },
              }
            : {})}
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
