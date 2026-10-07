import { pluginProxy } from '../../../../lib/plugin-proxy';
import { squadronsUrlFrom } from '../../../../lib/squadrons-url';

// Answer every request fresh: squadrons' state changes.
export const dynamic = 'force-dynamic';

/** The squadrons API for the browser, through the web app's server (decision 0017; lib/plugin-proxy.ts). */
export const { GET, POST } = pluginProxy({
  name: 'squadrons',
  url: () => squadronsUrlFrom(process.env),
  queries: new Set(['catalogue.list', 'squadrons.list', 'squadrons.messages', 'repositories.list']),
  mutations: new Set(['squadrons.form', 'squadrons.standDown', 'squadrons.forceStandDown', 'squadrons.addMember', 'squadrons.removeMember', 'squadrons.newCrewLine', 'catalogue.refresh', 'repositories.add', 'repositories.remove']),
});
