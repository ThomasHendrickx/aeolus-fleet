'use client';

import { Ellipsis, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@aeolus-fleet/ui';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import type { NamespaceSection } from '../../services/scope-namespaces';

type ListedScope = NamespaceSection['scopes'][number];

interface ScopesListProps {
  /** The fleet's namespaces, core first; undefined while they load. */
  sections: readonly NamespaceSection[] | undefined;
  error?: string;
  onRetry: () => void;
  /** Define scope: offered with scopes:define. */
  onDefine?: () => void;
  /** A fleet scope's menu: offered with scopes:define. */
  onDescribe?: (scope: ListedScope) => void;
  onRemove?: (scope: ListedScope) => void;
}

/** A fleet scope's menu: Change description…, and Remove…. */
function RowMenu({ scope, onDescribe, onRemove }: { scope: ListedScope } & Pick<ScopesListProps, 'onDescribe' | 'onRemove'>) {
  if (onDescribe === undefined || onRemove === undefined) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" isIconOnly aria-label={`Actions for ${scope.scope}`} icon={<Ellipsis />} data-testid="scopes-row-menu" />} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="scopes-describe"
          onClick={() => {
            onDescribe(scope);
          }}
        >
          <Pencil aria-hidden />
          Change description…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="scopes-remove"
          onClick={() => {
            onRemove(scope);
          }}
        >
          <Trash2 aria-hidden />
          Remove…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One namespace: its name, whose it is, and each scope with what it allows. */
function Namespace({ section, onDescribe, onRemove }: { section: NamespaceSection } & Pick<ScopesListProps, 'onDescribe' | 'onRemove'>) {
  return (
    <section aria-labelledby={`scopes-namespace-${section.namespace}`} className="overflow-hidden rounded-lg border border-border bg-card" data-testid={`scopes-namespace-${section.namespace}`}>
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 max-sm:px-3.5">
        <h2 id={`scopes-namespace-${section.namespace}`} className="font-mono text-body font-medium">
          {section.namespace}
        </h2>
        <span className="text-meta text-muted-foreground">{section.isFleetOwn ? section.whose : `${section.whose} · read-only`}</span>
      </header>
      <ul aria-label={`Scopes in ${section.namespace}`}>
        {section.scopes.map((scope) => (
          <li key={scope.scope} className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5 last:border-0 max-sm:flex-col max-sm:gap-1 max-sm:px-3.5" data-testid={`scopes-row-${scope.scope}`}>
            <span className="flex min-w-0 flex-1 items-baseline gap-3 max-sm:flex-col max-sm:gap-0.5">
              <span className="w-56 shrink-0 font-mono text-id text-foreground max-sm:w-auto">{scope.scope}</span>
              <span className="min-w-0 text-body text-foreground max-sm:text-body-touch" data-testid="scopes-description">
                {scope.description}
              </span>
            </span>
            {section.isFleetOwn ? (
              <span className="max-sm:self-end">
                <RowMenu scope={scope} onDescribe={onDescribe} onRemove={onRemove} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The fleet's scopes (design gateway-scopes, 4.1): every namespace with its
 * scopes and what each allows, saying whose it is. Core's and the plugins'
 * are read-only; the fleet's own have a menu to change a description or
 * remove the scope, for an actor holding scopes:define. The fleet's own come
 * after the others, with a line inviting the first one while there is none.
 */
export function ScopesList({ sections, error, onRetry, onDefine, onDescribe, onRemove }: ScopesListProps) {
  if (error !== undefined) {
    return (
      <InlineError
        variant="page"
        title="Couldn’t load scopes"
        description="This page couldn’t reach the fleet server. Nothing changed; the fleet's scopes are as they were."
        detail={error}
        onRetry={onRetry}
      />
    );
  }
  if (sections === undefined) {
    return <LoadingSkeleton variant="list" rows={6} label="Loading scopes" />;
  }
  const hasFleetOwn = sections.some((section) => section.isFleetOwn);
  return (
    <div className="flex flex-col gap-4" data-testid="scopes-list">
      {sections.map((section) => (
        <Namespace key={section.namespace} section={section} onDescribe={onDescribe} onRemove={onRemove} />
      ))}
      {hasFleetOwn ? null : (
        <EmptyState
          icon={<KeyRound aria-hidden />}
          title="No scopes of the fleet's own yet"
          description="Name what your ships may do at outside parties in your company's words, like crm:read-leads. Defining a scope grants it to no ship: argo holds it and grants it onwards."
          action={
            onDefine === undefined ? undefined : (
              <Button variant="primary" icon={<Plus />} onClick={onDefine} data-testid="scopes-define-empty">
                Define scope
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
