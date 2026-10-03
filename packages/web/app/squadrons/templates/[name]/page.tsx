'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { SquadronsNotConnected } from '../../../../components/molecules/squadrons-not-connected';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { ComposeMessage } from '../../../../components/organisms/compose-message';
import { ConsoleCommands } from '../../../../components/organisms/console-commands';
import { TemplateView } from '../../../../components/organisms/template-view';
import { DetailLayout } from '../../../../components/templates/detail-layout';
import { useAccountMenu } from '../../../../lib/account';
import { useOpenInboxCount } from '../../../../lib/inbox';
import { useLiveFleet } from '../../../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../../../lib/needs-attention';
import { useNow } from '../../../../lib/now';
import { useSignInWhenSessionEnds } from '../../../../lib/session';
import { useHasSquadrons, useSquadronsConnection } from '../../../../lib/squadrons';
import { useCatalogue } from '../../../../lib/squadrons-api';
import { templateChoices, templatePath } from '../../../../lib/squadrons-view';

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
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const catalogue = useCatalogue();
  const connection = useSquadronsConnection();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);

  const template = templateChoices(catalogue.data ?? { templates: [] }).find(
    (each) => each.name === name && (query.repository === undefined || each.repository === query.repository),
  );
  const version = Number(query.version ?? template?.versions[0]?.version);

  return (
    <DetailLayout
      title={name}
      parent={{ href: '/squadrons?tab=templates', label: 'Templates' }}
      header={<h1 className="text-title font-semibold">{name}</h1>}
      live={liveFleet.live}
      nav={{ active: 'squadrons', inboxCount, attentionCount, hasSquadrons }}
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
      {connection === 'not-connected' ? (
        <SquadronsNotConnected />
      ) : catalogue.isError ? (
        <InlineError
          title="Couldn't read the template"
          description="The squadron manager couldn't read the catalogue. Members using it keep working."
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
