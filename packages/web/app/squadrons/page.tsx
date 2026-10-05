'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { Button } from '../../components/atoms/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/atoms/tabs';
import { BlueprintTable } from '../../components/organisms/blueprint-table';
import { TemplateTable } from '../../components/organisms/template-table';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { ConsoleNotices } from '../../components/organisms/console-notices';
import { FormSquadronDialog } from '../../components/organisms/form-squadron-dialog';
import { SquadronTable } from '../../components/organisms/squadron-table';
import { ListLayout } from '../../components/templates/list-layout';
import { SquadronsNotConnected } from '../../components/molecules/squadrons-not-connected';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useHasSquadrons, useSquadronsConnection } from '../../lib/squadrons';
import { useCatalogue, useFormSquadron, useSquadrons } from '../../lib/squadrons-api';
import { readSquadronView, squadronViewParams, type SquadronView } from '../../lib/squadron-filter';
import { blueprintChoices, templateChoices } from '../../lib/squadrons-view';

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
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const squadrons = useSquadrons();
  const connection = useSquadronsConnection();
  const catalogue = useCatalogue();
  const form = useFormSquadron();
  const [isForming, setIsForming] = useState(false);
  const access = useAccess();
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error]);
  const blueprints = blueprintChoices(catalogue.data ?? { blueprints: [] });
  const openForm = () => {
    form.reset();
    setIsForming(true);
  };

  return (
    <ListLayout
      title="Squadrons"
      description="Teams of ships formed from blueprints in git."
      live={liveFleet.live}
      nav={{
        active: 'squadrons',
        inboxCount,
        attentionCount,
        hasSquadrons,
        hasSettings: hasSquadrons && access.canManage,
      }}
      primaryAction={
        access.canManage && blueprints.length > 0 ? (
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={openForm} data-testid="squadrons-form">
            Form squadron
          </Button>
        ) : undefined
      }
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
        <FormSquadronDialog
          blueprints={blueprints}
          templates={catalogue.data?.templates ?? []}
          isOpen={isForming || isFormAsked}
          onOpenChange={(isOpen) => {
            setIsForming(isOpen);
            if (!isOpen && isFormAsked) {
              changeView(view);
            }
          }}
          isPending={form.isPending}
          error={form.error?.message}
          onSubmit={(blueprint) => {
            form.mutate(blueprint, {
              onSuccess: (formed) => {
                setIsForming(false);
                router.push(`/squadrons/${formed.squadronId}`);
              },
            });
          }}
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
    </ListLayout>
  );
}
