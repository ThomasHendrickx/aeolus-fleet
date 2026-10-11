'use client';

import { useRouter } from 'next/navigation';
import { use } from 'react';

import { EmptyState } from '../../../../../components/molecules/empty-state';
import { InlineError } from '../../../../../components/molecules/inline-error';
import { SquadronsNotConnected } from '../../../../../features/squadrons/molecules/squadrons-not-connected';
import { LoadingSkeleton } from '../../../../../components/molecules/loading-skeleton';
import { TemplateView } from '../../../../../features/squadrons/organisms/template-view';
import { DetailPage } from '../../../../../components/organisms/detail-page';
import { useConsoleFrame } from '../../../../../lib/console-frame';
import { useLiveFleet } from '../../../../../lib/live-fleet';
import { useNeedsAttention } from '../../../../../lib/needs-attention';
import { useSignInWhenSessionEnds } from '../../../../../lib/session';
import { useSquadronsConnection } from '../../../../../lib/squadrons';
import { useCatalogue } from '../../../../../lib/squadrons-api';
import { templateChoices, templatePath } from '../../../../../lib/squadrons-view';

/** A ship template's page: one version read only, picked in the URL (the latest when none is). */
export default function TemplatePage({
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
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  const template = templateChoices(catalogue.data ?? { templates: [] }).find(
    (each) => each.name === name && (query.repository === undefined || each.repository === query.repository),
  );
  const version = Number(query.version ?? template?.versions[0]?.version);

  return (
    <DetailPage
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title={name}
      parents={[{ href: '/squadrons', label: 'Squadrons' }, { href: '/squadrons?tab=templates', label: 'Templates' }]}
      header={<h1 className="text-title font-semibold">{name}</h1>}
      live={liveFleet.live}
    >
      {connection === 'not-connected' ? (
        <SquadronsNotConnected />
      ) : catalogue.isError ? (
        <InlineError
          title="Couldn’t read the template"
          description="The squadron manager couldn’t read the catalogue. Members using it keep working."
          detail={catalogue.error.message}
          onRetry={() => {
            void catalogue.refetch();
          }}
        />
      ) : !catalogue.data ? (
        <LoadingSkeleton variant="detail" label="Loading the template" />
      ) : !template ? (
        <EmptyState title="No such template" description={`git holds no template ${name}.`} />
      ) : (
        <TemplateView
          template={template}
          version={version}
          onVersionChange={(picked) => {
            router.replace(templatePath({ repository: template.repository, name: template.name, version: picked }));
          }}
          blueprints={catalogue.data.blueprints}
        />
      )}
    </DetailPage>
  );
}
