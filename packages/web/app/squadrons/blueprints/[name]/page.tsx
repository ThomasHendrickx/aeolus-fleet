'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { BlueprintView } from '../../../../components/organisms/blueprint-view';
import { ComposeMessage } from '../../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../../components/organisms/console-commands';
import { ConsoleNotices } from '../../../../components/organisms/console-notices';
import { FormSquadronDialog } from '../../../../components/organisms/form-squadron-dialog';
import { DetailLayout } from '../../../../components/templates/detail-layout';
import { SquadronsNotConnected } from '../../../../components/molecules/squadrons-not-connected';
import { useAccess } from '../../../../lib/access';
import { useAccountMenu } from '../../../../lib/account';
import { useOpenInboxCount } from '../../../../lib/inbox';
import { useLiveFleet } from '../../../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../../../lib/needs-attention';
import { useNow } from '../../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../../lib/session';
import { useHasSquadrons, useSquadronsConnection } from '../../../../lib/squadrons';
import { useCatalogue, useFormSquadron, useSquadrons } from '../../../../lib/squadrons-api';
import { blueprintChoices, blueprintPath, squadronsFromBlueprint } from '../../../../lib/squadrons-view';

/**
 * A blueprint's page: one version read only, picked in the URL (the latest
 * when none is), with Form squadron starting from it.
 */
export default function BlueprintPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ repository?: string; version?: string }>;
}) {
  const name = decodeURIComponent(use(params).name);
  const query = use(searchParams);
  const router = useRouter();
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const catalogue = useCatalogue();
  const connection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const form = useFormSquadron();
  const [isForming, setIsForming] = useState(false);
  const access = useAccess();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  const choices = blueprintChoices(catalogue.data ?? { blueprints: [] });
  const blueprint = choices.find((each) => each.name === name && (query.repository === undefined || each.repository === query.repository));
  const version = Number(query.version ?? blueprint?.versions[0]?.version);

  return (
    <DetailLayout
      title={name}
      parent={{ href: '/squadrons', label: 'Squadrons' }}
      header={<h1 className="text-title font-semibold">{name}</h1>}
      live={liveFleet.live}
      nav={{ active: 'squadrons', inboxCount, attentionCount, hasSquadrons, hasSettings: hasSquadrons && access.canManage }}
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
      banner={<ConsoleNotices />}
    >
      {connection === 'not-connected' ? (
        <SquadronsNotConnected />
      ) : catalogue.isError ? (
        <InlineError
          title="Couldn’t read the blueprint"
          description="The squadron manager couldn’t read the catalogue. Squadrons formed from it keep sailing."
          detail={catalogue.error.message}
          onRetry={() => {
            void catalogue.refetch();
          }}
        />
      ) : !catalogue.data ? (
        <LoadingSkeleton variant="detail" label="Loading the blueprint" />
      ) : !blueprint ? (
        <EmptyState title="No such blueprint" description={`git holds no blueprint ${name}.`} />
      ) : (
        <>
          <BlueprintView
            blueprint={blueprint}
            version={version}
            onVersionChange={(picked) => {
              router.replace(blueprintPath({ repository: blueprint.repository, name: blueprint.name, version: picked }));
            }}
            templates={catalogue.data.templates}
            squadrons={squadronsFromBlueprint(squadrons.data ?? [], blueprint)}
            onForm={
              access.canManage
                ? () => {
                    form.reset();
                    setIsForming(true);
                  }
                : undefined
            }
          />
          <FormSquadronDialog
            key={`${blueprint.key}@${String(version)}`}
            blueprints={choices}
            templates={catalogue.data.templates}
            initial={{ key: blueprint.key, version }}
            isOpen={isForming}
            onOpenChange={setIsForming}
            isPending={form.isPending}
            error={form.error?.message}
            onSubmit={(picked) => {
              form.mutate(picked, {
                onSuccess: (formed) => {
                  setIsForming(false);
                  router.push(`/squadrons/${formed.squadronId}`);
                },
              });
            }}
          />
        </>
      )}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </DetailLayout>
  );
}
