/**
 * Where squadrons runs, from AEOLUS_SQUADRONS_URL, read by the web app's
 * server only: the browser never calls squadrons. Unset means the console has
 * no squadrons. No trailing slash.
 */
export function squadronsUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_SQUADRONS_URL;
  return configured === undefined || configured === '' ? undefined : configured.replace(/\/+$/, '');
}
