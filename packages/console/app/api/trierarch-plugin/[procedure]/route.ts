import { pluginProxy } from '../../../../lib/plugin-proxy';
import { trierarchPluginUrlFrom } from '../../../../lib/trierarch-plugin-url';

// Answer every request fresh: the trierarch plugin's state changes.
export const dynamic = 'force-dynamic';

/** The trierarch plugin's API for the browser, through the web app's server (decision 0030; lib/plugin-proxy.ts). */
export const { GET, POST } = pluginProxy({
  name: 'trierarch plugin',
  url: () => trierarchPluginUrlFrom(process.env),
  queries: new Set(['machines.list']),
  mutations: new Set(['machines.join']),
});
