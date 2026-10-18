/**
 * What the commission dialog offers to grant, from the fleet's scopes as
 * `fleet.scopes` lists them (decision 0046): the fleet scopes commissioning
 * grants, then each plugin's, so every switch shows the description the fleet
 * gives its scope rather than the console's own words.
 */

/** One namespace as `fleet.scopes` answers it: a core one, declared by no ship, or a plugin's. */
export interface FleetNamespace {
  namespace: string;
  declaredBy: { id: string; name: string } | null;
  scopes: readonly { scope: string; description: string }[];
}

/** The scopes offered under one heading: the fleet scopes, or one plugin's under its ship's name. */
export interface ScopeGroup {
  title: string;
  /** The plugin's namespace; null for the fleet scopes. */
  namespace: string | null;
  scopes: { scope: string; description: string }[];
}

/** The fleet scopes in the order given, each with its description, then each plugin namespace that declares a scope. */
export function grantableScopes(namespaces: readonly FleetNamespace[], fleetScopes: readonly string[]): ScopeGroup[] {
  const described = new Map(namespaces.filter(({ declaredBy }) => declaredBy === null).flatMap(({ scopes }) => scopes.map(({ scope, description }) => [scope, description] as const)));
  const fleet = fleetScopes.flatMap((scope) => {
    const description = described.get(scope);
    return description === undefined ? [] : [{ scope, description }];
  });
  const plugins = namespaces.flatMap(({ namespace, declaredBy, scopes }) =>
    declaredBy === null || scopes.length === 0 ? [] : [{ title: declaredBy.name, namespace, scopes: scopes.map(({ scope, description }) => ({ scope, description })) }],
  );
  return [{ title: 'Fleet access', namespace: null, scopes: fleet }, ...plugins];
}
