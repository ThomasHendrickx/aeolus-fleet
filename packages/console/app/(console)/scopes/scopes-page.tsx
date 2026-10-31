'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@aeolus-fleet/ui';
import { showToast } from '../../../components/atoms/toast';
import { DetailPage } from '../../../components/organisms/detail-page';
import { useDefineScope, useDescribeScope, useRemoveScope } from '../../../features/scopes/hooks/scopes';
import { namespaceSectionsOf } from '../../../features/scopes/services/scope-namespaces';
import { ScopesList } from '../../../features/scopes/ui/organisms/scopes-list';
import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useFleetScopes } from '../../../lib/fleet';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useSignInWhenSessionEnds } from '../../../lib/session';

// Dialogs load when first opened, not with the page.
const ScopeDialog = lazyDialog(() => import('../../../features/scopes/ui/organisms/scope-dialog').then((module) => module.ScopeDialog), (props) => props.isOpen);
const RemoveScopeDialog = lazyDialog(() => import('../../../features/scopes/ui/organisms/remove-scope-dialog').then((module) => module.RemoveScopeDialog), (props) => props.scope !== undefined);

const DESCRIPTION = 'What a ship may do, by namespace: core’s, each plugin’s, and the fleet’s own in your company’s words. A ship holds a scope once it is granted.';

/**
 * Scopes (design gateway-scopes, 4.1): Fleet overview › Scopes. Every
 * namespace with its scopes and what each allows, for a session holding
 * fleet:read; Define scope, Change description and Remove for the fleet's
 * own, for a session holding scopes:define, each refusal inline.
 */
export function ScopesPage() {
  const frame = useConsoleFrame();
  const liveFleet = useLiveFleet();
  const access = useAccess();
  const scopes = useFleetScopes();
  const define = useDefineScope();
  const describe = useDescribeScope();
  const remove = useRemoveScope();
  const [isDefining, setIsDefining] = useState(false);
  const [describing, setDescribing] = useState<{ scope: string; description: string } | undefined>(undefined);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  useSignInWhenSessionEnds([liveFleet.error, scopes.error]);

  const canDefine = access.canDefineScopes;
  const sections = scopes.data === undefined ? undefined : namespaceSectionsOf(scopes.data);
  const openDefine = () => {
    define.reset();
    setIsDefining(true);
  };

  return (
    <DetailPage
      switcher={frame.switcher}
      account={frame.account}
      onCompose={frame.onCompose}
      onSearch={frame.onSearch}
      banner={frame.banner}
      title="Scopes"
      parents={[{ href: '/', label: 'Fleet overview' }]}
      live={liveFleet.live}
      header={
        <div className="flex flex-wrap items-start justify-between gap-4 max-sm:gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-title font-semibold tracking-tight max-sm:text-title-touch">Scopes</h1>
            <p className="text-meta text-muted-foreground max-sm:text-body-touch">{DESCRIPTION}</p>
          </div>
          {canDefine && sections !== undefined ? (
            <Button variant="primary" icon={<Plus />} className="max-sm:w-full" data-testid="scopes-define" onClick={openDefine}>
              Define scope
            </Button>
          ) : null}
        </div>
      }
    >
      <ScopesList
        sections={sections}
        error={scopes.isError ? scopes.error.message : undefined}
        onRetry={() => {
          void scopes.refetch();
        }}
        onDefine={canDefine ? openDefine : undefined}
        onDescribe={
          canDefine
            ? (scope) => {
                describe.reset();
                setDescribing(scope);
              }
            : undefined
        }
        onRemove={
          canDefine
            ? ({ scope }) => {
                remove.reset();
                setRemoving(scope);
              }
            : undefined
        }
      />
      {canDefine ? (
        <>
          <ScopeDialog
            isOpen={isDefining || describing !== undefined}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                setIsDefining(false);
                setDescribing(undefined);
              }
            }}
            {...(describing === undefined ? {} : { describing })}
            isPending={describing === undefined ? define.isPending : describe.isPending}
            error={describing === undefined ? define.error?.message : describe.error?.message}
            onSubmit={(scope) => {
              if (describing === undefined) {
                define.mutate(scope, {
                  onSuccess: () => {
                    setIsDefining(false);
                    showToast({ title: 'Scope defined', description: `${scope.scope} is the fleet's own. Grant it to ships that need it.` });
                  },
                });
                return;
              }
              describe.mutate(scope, {
                onSuccess: () => {
                  setDescribing(undefined);
                  showToast({ title: 'Description changed', description: `${scope.scope}: ${scope.description}` });
                },
              });
            }}
          />
          <RemoveScopeDialog
            scope={removing}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                setRemoving(undefined);
              }
            }}
            isPending={remove.isPending}
            error={remove.error?.message}
            onRemove={(scope) => {
              remove.mutate(
                { scope },
                {
                  onSuccess: () => {
                    setRemoving(undefined);
                    showToast({ title: 'Scope removed', description: `${scope} is gone from the fleet.` });
                  },
                },
              );
            }}
          />
        </>
      ) : null}
    </DetailPage>
  );
}
