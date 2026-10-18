/** The plugin namespace squadrons declares and enforces itself (decisions 0017 and 0046). */
export const SQUADRONS_NAMESPACE = 'squadrons';

/**
 * Whether squadrons may grant a scope at commission, by the subset rule
 * (decision 0046): a scope its own ship holds, or one of its own namespace.
 */
export function isGrantable(scope: string, held: readonly string[]): boolean {
  return held.includes(scope) || scope.startsWith(`${SQUADRONS_NAMESPACE}:`);
}
