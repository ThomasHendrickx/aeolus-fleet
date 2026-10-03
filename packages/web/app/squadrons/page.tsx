'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../../components/atoms/button';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { FormSquadronDialog } from '../../components/organisms/form-squadron-dialog';
import { SquadronTable } from '../../components/organisms/squadron-table';
import { ListLayout } from '../../components/templates/list-layout';
import { useAccountMenu } from '../../lib/account';
import { useOpenInboxCount } from '../../lib/inbox';
import { useLiveFleet } from '../../lib/live-fleet';
import { useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { useSignInWhenSessionEnds } from '../../lib/session';
import { useHasSquadrons } from '../../lib/squadrons';
import { useCatalogue, useFormSquadron, useSquadrons } from '../../lib/squadrons-api';
import { blueprintChoices } from '../../lib/squadrons-view';

/**
 * Squadrons: every squadron of the fleet, and Form squadron, which opens the
 * new squadron's page with each member's crew line and launch note.
 */
export default function SquadronsPage() {
  const router = useRouter();
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const hasSquadrons = useHasSquadrons();
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const liveFleet = useLiveFleet();
  const squadrons = useSquadrons();
  const catalogue = useCatalogue();
  const form = useFormSquadron();
  const [isForming, setIsForming] = useState(false);
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
        attentionCount: attention.data?.length,
        hasSquadrons,
      }}
      primaryAction={
        blueprints.length > 0 ? (
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={openForm} data-testid="squadrons-form">
            Form squadron
          </Button>
        ) : undefined
      }
      onCompose={() => {
        setIsComposing(true);
      }}
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
    >
      <SquadronTable
        squadrons={squadrons.data ?? []}
        state={squadrons.isError ? 'error' : squadrons.data ? 'ready' : 'loading'}
        hasBlueprints={blueprints.length > 0}
        error={squadrons.error?.message}
        onRetry={() => {
          void squadrons.refetch();
        }}
        onForm={openForm}
      />
      {blueprints.length > 0 && (
        <FormSquadronDialog
          blueprints={blueprints}
          templates={catalogue.data?.templates ?? []}
          isOpen={isForming}
          onOpenChange={setIsForming}
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
