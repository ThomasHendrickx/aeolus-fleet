import type { GuardConfiguration } from '../../../lib/trierarch-plugin-guard-schemas';
import type { guardReplacement } from '../services/guard-configuration';

const TIMEOUT_MS = 35_000; // Allow for the console's network hop after the plugin's 30-second deadline.
const READ_FAILURE = 'The trierarch plugin did not answer with its rule sets.';
const UPDATE_FAILURE = 'The trierarch plugin did not confirm the update. Try again.';
const WRITE_FAILURE = 'The trierarch plugin did not confirm the change. Read the rule sets again before saving.';

export type GuardSaveResult = { kind: 'saved' } | { kind: 'conflict' } | { kind: 'uncertain' | 'refused'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The console route already validates and projects the plugin's catalogue. */
function hasCatalogue(value: unknown): value is { result: { data: GuardConfiguration } } {
  return isRecord(value) && isRecord(value.result) && isRecord(value.result.data);
}

function refusal(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== 'string') return undefined;
  return value.error.message.trim() || undefined;
}

export async function readGuardConfiguration(signal?: AbortSignal): Promise<GuardConfiguration> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  let answer: unknown;
  try {
    response = await fetch('/api/trierarch-plugin/guard.get', {
      cache: 'no-store',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    answer = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(READ_FAILURE, { cause: error });
  }
  if (response.ok && hasCatalogue(answer)) return answer.result.data;
  throw new Error(refusal(answer) ?? READ_FAILURE);
}

export async function replaceGuardConfiguration(replacement: ReturnType<typeof guardReplacement>): Promise<GuardSaveResult> {
  try {
    const response = await fetch('/api/trierarch-plugin/guard.replace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replacement),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 409) return { kind: 'conflict' };
    if (response.status >= 500) return { kind: 'uncertain', message: WRITE_FAILURE };
    const answer: unknown = await response.json();
    if (!response.ok) return { kind: 'refused', message: refusal(answer) ?? 'The trierarch plugin refused the change. Try again.' };
    if (isRecord(answer) && isRecord(answer.result) && isRecord(answer.result.data) && typeof answer.result.data.version === 'number') {
      return { kind: 'saved' };
    }
  } catch {
    return { kind: 'uncertain', message: WRITE_FAILURE };
  }
  return { kind: 'uncertain', message: WRITE_FAILURE };
}


export async function updateGuardRepository(repository: string): Promise<
  { kind: 'answered'; configuration: GuardConfiguration } | { kind: 'unconfirmed'; reason: string }
> {
  try {
    const response = await fetch('/api/trierarch-plugin/guard.update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const answer: unknown = await response.json();
    if (response.ok && hasCatalogue(answer)) return { kind: 'answered', configuration: answer.result.data };
    return { kind: 'unconfirmed', reason: refusal(answer) ?? UPDATE_FAILURE };
  } catch {
    return { kind: 'unconfirmed', reason: UPDATE_FAILURE };
  }
}
