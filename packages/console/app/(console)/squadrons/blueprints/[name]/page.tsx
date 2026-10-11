'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { EmptyState } from '../../../../../components/molecules/empty-state';
import { InlineError } from '../../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../../components/molecules/loading-skeleton';
import { BlueprintView } from '../../../../../features/squadrons/organisms/blueprint-view';
import { FormSquadron } from '../../../../../features/squadrons/organisms/form-squadron';
import { DetailPage } from '../../../../../components/organisms/detail-page';
import { useConsoleFrame } from '../../../../../lib/console-frame';
import { SquadronsNotConnected } from '../../../../../features/squadrons/molecules/squadrons-not-connected';
import { useAccess } from '../../../../../lib/access';
import { useLiveFleet } from '../../../../../lib/live-fleet';
import { useNeedsAttention } from '../../../../../lib/needs-attention';
import { useSignInWhenSessionEnds } from '../../../../../lib/session';
import { useSquadronsConnection } from '../../../../../lib/squadrons';
import { useCatalogue, useSquadrons } from '../../../../../lib/squadrons-api';
import { blueprintChoices, blueprintPath, squadronsFromBlueprint } from '../../../../../lib/squadrons-view';

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
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const catalogue = useCatalogue();
  const connection = useSquadronsConnection();
  const squadrons = useSquadrons();
  const [isForming, setIsForming] = useState(false);
  const access = useAccess();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  const choices = blueprintChoices(catalogue.data ?? { blueprints: [] });
  const blueprint = choices.find((each) => each.name === name && (query.repository === undefined || each.repository === query.repository));
  const version = Number(query.version ?? blueprint?.versions[0]?.version);

  return (
    <DetailPage
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title={name}
      parents={[{ href: '/squadrons', label: 'Squadrons' }, { href: '/squadrons?tab=blueprints', label: 'Blueprints' }]}
      header={<h1 className="text-title font-semibold">{name}</h1>}
      live={liveFleet.live}
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
                    setIsForming(true);
                  }
                : undefined
            }
          />
          <FormSquadron
            key={`${blueprint.key}@${String(version)}`}
            blueprints={choices}
            templates={catalogue.data.templates}
            initial={{ key: blueprint.key, version }}
            isOpen={isForming}
            onOpenChange={setIsForming}
            onFormed={(squadronId) => {
              setIsForming(false);
              router.push(`/squadrons/${squadronId}`);
            }}
          />
        </>
      )}
    </DetailPage>
  );
}
