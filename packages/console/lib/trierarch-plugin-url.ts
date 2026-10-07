/**
 * Where the trierarch plugin runs, from AEOLUS_TRIERARCH_PLUGIN_URL, read by
 * the web app's server only: the browser never calls the trierarch plugin.
 * Unset means the console has no trierarch plugin. No trailing slash.
 */
export function trierarchPluginUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_TRIERARCH_PLUGIN_URL;
  return configured === undefined || configured === '' ? undefined : configured.replace(/\/+$/, '');
}
