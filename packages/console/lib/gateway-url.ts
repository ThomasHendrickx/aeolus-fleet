/**
 * Where the gateway runs, from AEOLUS_GATEWAY_URL, read by the web app's
 * server only: the browser never calls the gateway. Unset means the console
 * has no gateway. No trailing slash.
 */
export function gatewayUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_GATEWAY_URL;
  return configured === undefined || configured === '' ? undefined : configured.replace(/\/+$/, '');
}
