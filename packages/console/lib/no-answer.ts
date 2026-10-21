/**
 * What a failed call says when the plugin or the fleet did not answer: the
 * web app's server refuses with it (lib/*-reads.ts), and the browser falls
 * back to it when the server function itself does not answer (dataFrom in
 * lib/plugin-answer.ts).
 */

export const GATEWAY_NO_ANSWER = 'the gateway or the fleet did not answer: try again in a moment';
export const SQUADRONS_NO_ANSWER = 'squadrons or the fleet did not answer: try again in a moment';
export const TRIERARCH_PLUGIN_NO_ANSWER = 'the trierarch plugin or the fleet did not answer: try again in a moment';
