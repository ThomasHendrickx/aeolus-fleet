'use client';

import type { GuardChoices } from './guard-choices';
import { useConsoleRead } from './console-read-query';
import { useHasTrierarchPlugin } from './trierarch-plugin';

// The route bounds the plugin at 30 seconds; allow five more for the browser's network hop.
const READ_TIMEOUT_MS = 35_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

async function readChoices(): Promise<GuardChoices> {
  const response = await fetch('/api/trierarch-plugin/guard.get', { cache: 'no-store', signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('The trierarch plugin did not answer with its rule sets');
  }
  const data = body.result.data;
  if (!Array.isArray(data.sets) || !isNames(data.floor)) throw new Error('The trierarch plugin answered with invalid rule sets');
  const names = data.sets.flatMap((set: unknown) => isRecord(set) && typeof set.name === 'string' ? [set.name] : []);
  if (names.length !== data.sets.length) throw new Error('The trierarch plugin answered with invalid rule sets');
  return { names, floor: data.floor };
}

/** Each open reads current choices; only names and floor enter the browser query cache. */
export function useGuardChoices(isOpen: boolean) {
  const hasPlugin = useHasTrierarchPlugin();
  return useConsoleRead({
    queryKey: ['trierarch-plugin', 'guard-choices'],
    queryFn: readChoices,
    enabled: isOpen && hasPlugin,
    staleTime: 0,
    retry: false,
  });
}
