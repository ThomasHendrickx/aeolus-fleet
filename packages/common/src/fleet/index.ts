import { z } from 'zod';

/**
 * The fleet's shared vocabulary (docs/blueprint.md, "Ubiquitous language"):
 * scopes, ship kinds, ship statuses, lease locations, selector kinds, delivery
 * states and event types. Server and web use the same words.
 */

/** A permission of a ship, stored on the server with the ship and checked before every call. */
export const SCOPES = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew', 'crew:assign', 'crew:run'] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/**
 * The scopes commissioning may add to an agent ship, beside sending and
 * receiving, which every agent ship has (ADR 0002). `fleet:crew` is the 0.17
 * trierarch's: it reads one ship, gets its starting prompt and releases it.
 * `crew:assign` writes crew request assignments; `crew:run` crews the ships
 * whose requests are assigned to its ship (decision 0029).
 */
export const FLEET_SCOPES = ['fleet:read', 'fleet:manage', 'fleet:crew', 'crew:assign', 'crew:run'] as const;
export const fleetScopeSchema = z.enum(FLEET_SCOPES);
export type FleetScope = z.infer<typeof fleetScopeSchema>;

/** `argo` is the one ship of kind `operator` in a fleet; every other ship is an `agent`. */
export const SHIP_KINDS = ['operator', 'agent', 'viewer'] as const;
export const shipKindSchema = z.enum(SHIP_KINDS);
export type ShipKind = z.infer<typeof shipKindSchema>;

/** Where the session crewing a ship runs. `OTHER` carries a short description. */
export const LOCATION_KINDS = ['DEVICE', 'CLOUD', 'SERVER', 'OTHER'] as const;
export const locationKindSchema = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof locationKindSchema>;

/**
 * Whether a ship awaits crew, is crewed or is retired. Derived from its lease
 * and its retired date, never set by hand.
 */
export const SHIP_STATUSES = ['awaitingCrew', 'crewed', 'retired'] as const;
export const shipStatusSchema = z.enum(SHIP_STATUSES);
export type ShipStatus = z.infer<typeof shipStatusSchema>;

/** Who a message is for: one ship (by id or by name) or any ship of a type. Group and fleet come later. */
export const SELECTOR_KINDS = ['ship', 'type'] as const;
export const selectorKindSchema = z.enum(SELECTOR_KINDS);
export type SelectorKind = z.infer<typeof selectorKindSchema>;

/**
 * Where one delivery stands (docs/blueprint.md, "Key flows"): pending until a
 * ship receives it, then delivered (claimed and in flight) until it is
 * acknowledged or returns to pending.
 */
export const DELIVERY_STATES = ['pending', 'delivered', 'acknowledged', 'undeliverable', 'dismissed', 'abandoned'] as const;
export const deliveryStateSchema = z.enum(DELIVERY_STATES);
export type DeliveryState = z.infer<typeof deliveryStateSchema>;

/** The event types written so far. Each later slice adds the ones it writes. */
export const EVENT_TYPES = [
  'FleetInitialised',
  'ShipCommissioned',
  'ShipClaimed',
  'LeaseRevoked',
  'CredentialRevoked',
  'StartingPromptIssued',
  'OperatorPasswordReset',
  'MessageAccepted',
  'DeliveryClaimed',
  'DeliveryAcknowledged',
  'DeliveryUndeliverable',
  'DeliveryReturned',
  'ShipRetired',
  'DeliveryAbandoned',
  'DeliveryDismissed',
  'ShipRenamed',
  'ShipReported',
  'SignInTicketIssued',
  'FleetLimitsChanged',
  'ViewerSessionStarted',
  'CrewRequested',
  'CrewRequestRemoved',
  'CrewAssigned',
  'CrewStatusChanged',
  'CrewRequestExplained',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export * from './mcp-url.js';
