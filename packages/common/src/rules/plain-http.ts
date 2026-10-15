/**
 * Plain http beyond localhost: the console's session cookie is Secure, so a
 * browser drops it there, and passwords and crew tokens travel in clear
 * text. Browsers treat localhost, names under it and loopback addresses as
 * secure contexts, so plain http there is fine.
 */

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Whether a browser treats this host as secure over plain http. */
function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || LOOPBACK_IPV4.test(hostname) || hostname === '[::1]';
}

/** The startup warning for a setting holding a plain http URL beyond localhost; undefined when it holds none. */
export function plainHttpWarning(setting: string, url: string): string | undefined {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== 'http:' || isLocalhost(parsed.hostname)) {
    return undefined;
  }
  return `${setting} is plain http on ${parsed.hostname}: browsers drop the Secure session cookie, so console sign-in fails, and passwords and crew tokens travel in clear text. Put a TLS proxy in front and use https (README, "Beyond localhost").`;
}
