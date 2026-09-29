import { z } from 'zod';

/**
 * The fleet's shared vocabulary (docs/blueprint.md, "Ubiquitous language"):
 * scopes, ship kinds, lease locations and event types. Server and web use the
 * same words.
 */

/** A permission of a ship, stored on the server with the ship and checked before every call. */
export const SCOPES = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/** `argo` is the one ship of kind `operator` in a fleet; every other ship is an `agent`. */
export const SHIP_KINDS = ['operator', 'agent'] as const;
export const shipKindSchema = z.enum(SHIP_KINDS);
export type ShipKind = z.infer<typeof shipKindSchema>;

/** Where the session crewing a ship runs. `OTHER` carries a short description. */
export const LOCATION_KINDS = ['DEVICE', 'CLOUD', 'SERVER', 'OTHER'] as const;
export const locationKindSchema = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof locationKindSchema>;

/** The event types written so far. Each later slice adds the ones it writes. */
export const EVENT_TYPES = [
  'FleetInitialised',
  'ShipCommissioned',
  'ShipClaimed',
  'LeaseRevoked',
  'CredentialRevoked',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;
