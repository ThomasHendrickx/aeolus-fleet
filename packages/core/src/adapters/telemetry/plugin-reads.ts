import { metrics } from '@opentelemetry/api';

import type { CountedPluginReadFailure } from '../../domain/registry/record-plugin-read.js';
import { INSTRUMENTATION_SCOPE } from './calls.js';

/** Counts each committed failure, including repeated failures during one outage. */
export function countPluginReadFailure({ plugin, read, reason }: CountedPluginReadFailure): void {
  metrics.getMeter(INSTRUMENTATION_SCOPE)
    .createCounter('aeolus.plugin_read.failed', { unit: '{read}', description: 'Recorded failed plugin reads' })
    .add(1, { plugin, read, reason });
}
