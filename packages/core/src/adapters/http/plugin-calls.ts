/** One synchronous server-authenticated dispatch. Never follow redirects or retry a plugin operation. */
import { pluginCallAnswerSchema, type PluginCallContext, type PluginRefusalCode } from '@aeolus-fleet/common';

import type { PluginCalls, PluginCallRefusal } from '../../domain/registry/plugin-calls.js';
import { err } from '../../domain/shared/result.js';
import type { PluginTarget } from './plugin-targets.js';

function refused(code: PluginRefusalCode, message: string) {
  return err<PluginCallRefusal>({ kind: 'PLUGIN_REFUSED', code, message });
}

export interface PluginDispatchLog {
  requestId: string;
  pluginShipId: string;
  procedure: string;
  durationMs: number;
  outcome: string;
}

export function createHttpPluginCalls(options: { targets: readonly PluginTarget[]; now: () => Date; log?: (facts: PluginDispatchLog) => void }): PluginCalls {
  const dispatch: PluginCalls['dispatch'] = async (context: PluginCallContext) => {
    const target = options.targets.find((candidate) => candidate.fleetId === context.fleetId && candidate.pluginShipId === context.pluginShipId);
    if (!target) return refused('NOT_FOUND', 'Plugin endpoint is not configured; no operation started');
    const remaining = Date.parse(context.expiresAt) - options.now().getTime();
    if (remaining <= 0) return refused('TIMEOUT', 'Plugin dispatch expired; no operation started');
    const unknown = `Plugin outcome unknown; read current state before retrying (request ${context.requestId})`;
    try {
      const response = await fetch(target.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'aeolus-plugin-secret': target.secret }, body: JSON.stringify(context), signal: AbortSignal.timeout(remaining) });
      if (response.status >= 300 && response.status < 400) return refused('BAD_GATEWAY', unknown);
      const body: unknown = await response.json();
      const answer = pluginCallAnswerSchema.safeParse(body);
      if (!answer.success) return refused('BAD_GATEWAY', unknown);
      if ('error' in answer.data) {
        const { code } = answer.data.error.data;
        return refused(code, code === 'BAD_GATEWAY' || code === 'TIMEOUT' || code === 'INTERNAL_SERVER_ERROR' ? unknown : `Plugin operation refused: ${code} (request ${context.requestId})`);
      }
      if (!response.ok) return refused('BAD_GATEWAY', unknown);
      return { isOk: true, value: answer.data.result.data };
    } catch (error) {
      if (error instanceof Error && 'cause' in error && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ECONNREFUSED') {
        return refused('BAD_GATEWAY', `Plugin unavailable; no operation started (request ${context.requestId})`);
      }
      return refused(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'TIMEOUT' : 'BAD_GATEWAY', unknown);
    }
  };
  return { dispatch: async (context) => {
    const startedAt = performance.now();
    const answer = await dispatch(context);
    options.log?.({ requestId: context.requestId, pluginShipId: context.pluginShipId, procedure: context.procedure, durationMs: performance.now() - startedAt, outcome: answer.isOk ? 'OK' : answer.error.code });
    return answer;
  } };
}
