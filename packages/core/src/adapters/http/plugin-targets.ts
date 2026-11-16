/** Deployment settings only: endpoints and shared secrets never live in a fleet or actor input. */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

/** Plain HTTP is restricted to literal loopback/private addresses, so DNS cannot turn it public. */
function isAllowedEndpoint(value: string): boolean {
  const url = URL.parse(value);
  if (url?.username !== '' || url.password !== '' || url.hash !== '' || url.search !== '') return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  if (host === '[::1]' || host === 'localhost') return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second = 0] = octets;
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export const pluginTargetsSchema = z.array(z.strictObject({
  fleetId: idSchema('fleet'), pluginShipId: idSchema('ship'),
  url: z.string().refine(isAllowedEndpoint, 'must be HTTPS or HTTP on a private literal address'),
  secret: z.string().min(32),
})).refine((targets) => new Set(targets.map((target) => `${target.fleetId}:${target.pluginShipId}`)).size === targets.length, 'duplicate plugin target');
export type PluginTarget = z.infer<typeof pluginTargetsSchema>[number];
