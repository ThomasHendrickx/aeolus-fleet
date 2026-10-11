'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { Button } from '../../../components/atoms/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/atoms/tabs';
import { BlueprintTable } from '../../../features/squadrons/organisms/blueprint-table';
import { TemplateTable } from '../../../features/squadrons/organisms/template-table';
import { FormSquadron } from '../../../features/squadrons/organisms/form-squadron';
import { SquadronTable } from '../../../features/squadrons/organisms/squadron-table';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { SquadronsNotConnected } from '../../../features/squadrons/molecules/squadrons-not-connected';
import { useAccess } from '../../../lib/access';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNeedsAttention } from '../../../lib/needs-attention';
import { useSignInWhenSessionEnds } from '../../../lib/session';
import { useSquadronsConnection } from '../../../lib/squadrons';
import { useCatalogue, useSquadrons } from '../../../lib/squadrons-api';
import { readSquadronView, squadronViewParams, type SquadronView } from '../../../features/squadrons/lib/squadron-filter';
import { blueprintChoices, templateChoices } from '../../../lib/squadrons-view';

/** The page's sections, in the URL as `tab`; Squadrons when none. */
const TABS = ['squadrons', 'blueprints', 'templates'] as const;
type Tab = (typeof TABS)[number];

function tabOf(value: unknown): Tab {
  return TABS.find((each) => each === value) ?? 'squadrons';
}

/**
 * Squadrons: every squadron of the fleet, searched and filtered in the URL,
 * and Form squadron, which opens the new squadron's page with each member's
 * crew lines and launch note. Tabs (in the URL) show the blueprints and the
 * templates in git, read only.
 */
export default function SquadronsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const router = useRouter();
  const query = use(searchParams);
  const view = readSquadronView(new URLSearchParams(Object.entries(query).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : []))));
  // The command palette's Form squadron lands here with the dialog open.
  const isFormAsked = query.form === 'new';
  const tab = tabOf(query.tab);
  const changeView = (next: SquadronView) => {
    const params = squadronViewParams(next).toString();
    router.replace(params === '' ? '/squadrons' : `/squadrons?${params}`, { scroll: false });
  };
  const frame = useConsoleFrame();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const squadrons = useSquadrons();
  const connection = useSquadronsConnection();
  const catalogue = useCatalogue();
  const [isForming, setIsForming] = useState(false);
  const access = useAccess();
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const blueprints = blueprintChoices(catalogue.data ?? { blueprints: [] });
  const openForm = () => {
    setIsForming(true);
  };

  return (
    <ListPage
      {...frame}
      title="Squadrons"
      description="Teams of ships formed from blueprints in git."
      live={liveFleet.live}
      primaryAction={
        access.canManage && blueprints.length > 0 ? (
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={openForm} data-testid="squadrons-form">
            Form squadron
          </Button>
        ) : undefined
      }
    >
      {connection === 'not-connected' ? (
        <SquadronsNotConnected />
      ) : (
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = tabOf(value);
          router.replace(next === 'squadrons' ? '/squadrons' : `/squadrons?tab=${next}`, { scroll: false });
        }}
      >
        <TabsList variant="line" aria-label="Squadrons sections">
          <TabsTrigger variant="line" value="squadrons" data-testid="squadrons-tab-squadrons">
            Squadrons
          </TabsTrigger>
          <TabsTrigger variant="line" value="blueprints" data-testid="squadrons-tab-blueprints">
            Blueprints
          </TabsTrigger>
          <TabsTrigger variant="line" value="templates" data-testid="squadrons-tab-templates">
            Templates
          </TabsTrigger>
        </TabsList>
        <TabsContent value="squadrons" className="pt-4">
      <SquadronTable
        squadrons={squadrons.data ?? []}
        state={squadrons.isError ? 'error' : squadrons.data ? 'ready' : 'loading'}
        hasBlueprints={blueprints.length > 0}
        error={squadrons.error?.message}
        onRetry={() => {
          void squadrons.refetch();
        }}
        onForm={access.canManage ? openForm : undefined}
        view={view}
        onViewChange={changeView}
      />
        </TabsContent>
        <TabsContent value="blueprints" className="pt-4">
          <BlueprintTable
            blueprints={blueprints}
            squadrons={squadrons.data ?? []}
            state={catalogue.isError ? 'error' : catalogue.data ? 'ready' : 'loading'}
            error={catalogue.error?.message}
            onRetry={() => {
              void catalogue.refetch();
            }}
          />
        </TabsContent>
        <TabsContent value="templates" className="pt-4">
          <TemplateTable
            templates={templateChoices(catalogue.data ?? { templates: [] })}
            blueprints={catalogue.data?.blueprints ?? []}
            state={catalogue.isError ? 'error' : catalogue.data ? 'ready' : 'loading'}
            error={catalogue.error?.message}
            onRetry={() => {
              void catalogue.refetch();
            }}
          />
        </TabsContent>
      </Tabs>
      )}
      {blueprints.length > 0 && (
        <FormSquadron
          blueprints={blueprints}
          templates={catalogue.data?.templates ?? []}
          isOpen={isForming || isFormAsked}
          onOpenChange={(isOpen) => {
            setIsForming(isOpen);
            if (!isOpen && isFormAsked) {
              changeView(view);
            }
          }}
          onFormed={(squadronId) => {
            setIsForming(false);
            router.push(`/squadrons/${squadronId}`);
          }}
        />
      )}
    </ListPage>
  );
}
