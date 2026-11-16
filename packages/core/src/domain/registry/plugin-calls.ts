import type { PluginCallContext, PluginCallData, PluginRefusalCode } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

export interface PluginCallRefusal {
  kind: 'PLUGIN_REFUSED';
  code: PluginRefusalCode;
  message: string;
}

/** Dispatch once to server configuration only. Never retry an uncertain operation. */
export interface PluginCalls {
  dispatch(context: PluginCallContext): Promise<Result<PluginCallData, PluginCallRefusal>>;
}
