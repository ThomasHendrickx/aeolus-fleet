/**
 * Where the watch plugin runs, from AEOLUS_WATCH_PLUGIN_URL, read by the web
 * app's server only: the browser never calls the watch plugin. Unset means
 * the console has no watch plugin. No trailing slash.
 */
export function watchPluginUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_WATCH_PLUGIN_URL;
  return configured === undefined || configured === '' ? undefined : configured.replace(/\/+$/, '');
}
