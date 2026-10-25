/**
 * What the commission dialog offers to grant, from the fleet's scopes as
 * `fleet.scopes` lists them (decision 0046): the fleet scopes commissioning
 * grants, then each plugin's, then the fleet's own (design gateway-scopes,
 * 4.1), so every switch shows the description the fleet gives its scope rather
 * than the console's own words.
 */

/** The heading over a namespace of the fleet's own scopes, which no ship declared. */
const FLEET_OWN_TITLE = "The fleet's own";

/** One namespace as `fleet.scopes` answers it: a core one, a plugin's with the ship that declared it, or the fleet's own. */
export interface FleetNamespace {
  namespace: string;
  kind: 'core' | 'plugin' | 'fleet';
  declaredBy: { id: string; name: string } | null;
  scopes: readonly { scope: string; description: string }[];
}

/** The scopes offered under one heading: the fleet scopes, one plugin's under its ship's name, or one namespace of the fleet's own. */
export interface ScopeGroup {
  title: string;
  /** The plugin's or the fleet's namespace; null for the fleet scopes. */
  namespace: string | null;
  scopes: { scope: string; description: string }[];
}

/** The fleet scopes in the order given, each with its description, then each plugin namespace that declares a scope, then the fleet's own. */
export function grantableScopes(namespaces: readonly FleetNamespace[], fleetScopes: readonly string[]): ScopeGroup[] {
  const described = new Map(namespaces.filter(({ kind }) => kind === 'core').flatMap(({ scopes }) => scopes.map(({ scope, description }) => [scope, description] as const)));
  const fleet = fleetScopes.flatMap((scope) => {
    const description = described.get(scope);
    return description === undefined ? [] : [{ scope, description }];
  });
  const plugins = namespaces.flatMap(({ namespace, kind, declaredBy, scopes }) =>
    kind !== 'plugin' || declaredBy === null || scopes.length === 0 ? [] : [{ title: declaredBy.name, namespace, scopes: scopes.map(({ scope, description }) => ({ scope, description })) }],
  );
  const fleetOwn = namespaces.flatMap(({ namespace, kind, scopes }) => (kind !== 'fleet' ? [] : [{ title: FLEET_OWN_TITLE, namespace, scopes: scopes.map(({ scope, description }) => ({ scope, description })) }]));
  return [{ title: 'Fleet access', namespace: null, scopes: fleet }, ...plugins, ...fleetOwn];
}
