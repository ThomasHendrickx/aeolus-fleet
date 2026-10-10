/**
 * Where the networking plugin runs, from AEOLUS_NETWORKING_PLUGIN_URL, read by
 * the web app's server only: the browser never calls the networking plugin.
 * Unset means the console has no networking plugin. No trailing slash.
 */
export function networkingPluginUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_NETWORKING_PLUGIN_URL;
  return configured === undefined || configured === '' ? undefined : configured.replace(/\/+$/, '');
}
