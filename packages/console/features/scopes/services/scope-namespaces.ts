/**
 * The Scopes page's sections, from the fleet's scopes as `fleet.scopes`
 * lists them (decision 0046; design gateway-scopes, 4.1): each namespace
 * with whose it is, the core ones and the plugins' read-only, the fleet's own
 * changed by an actor holding scopes:define.
 */

/** One namespace as `fleet.scopes` answers it. */
export interface ListedNamespace {
  namespace: string;
  kind: 'core' | 'plugin' | 'fleet';
  declaredBy: { id: string; name: string } | null;
  scopes: readonly { scope: string; description: string }[];
}

/** One section of the page: a namespace, whose it is, and its scopes. */
export interface NamespaceSection {
  namespace: string;
  /** "Core", "Declared by squadrons" or "The fleet's own". */
  whose: string;
  /** Whether its scopes are the fleet's own, the only ones changed here. */
  isFleetOwn: boolean;
  scopes: { scope: string; description: string }[];
}

/** The sections in the order the fleet lists them, a plugin's named by the ship that declared it. */
export function namespaceSectionsOf(namespaces: readonly ListedNamespace[]): NamespaceSection[] {
  return namespaces.map(({ namespace, kind, declaredBy, scopes }) => ({
    namespace,
    whose: whoseOf(kind, declaredBy),
    isFleetOwn: kind === 'fleet',
    scopes: scopes.map(({ scope, description }) => ({ scope, description })),
  }));
}

function whoseOf(kind: ListedNamespace['kind'], declaredBy: ListedNamespace['declaredBy']): string {
  switch (kind) {
    case 'core':
      return 'Core';
    case 'plugin':
      return `Declared by ${declaredBy?.name ?? 'a plugin'}`;
    case 'fleet':
      return "The fleet's own";
  }
}
