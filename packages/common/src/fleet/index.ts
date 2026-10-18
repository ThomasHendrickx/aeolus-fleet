import { z } from 'zod';

/**
 * The fleet's shared vocabulary (docs/blueprint.md, "Ubiquitous language"):
 * scopes, ship kinds, ship statuses, lease locations, selector kinds, delivery
 * states and event types. Core and console use the same words.
 */

/**
 * A core scope: a permission of a ship, stored on the server with the ship
 * and checked by core before every call. `messages:force` sends a forced
 * message, one that comes first (decision 0040); `scopes:declare` takes up a
 * plugin namespace and `scopes:grant` grants and revokes on a live ship
 * (decision 0046).
 */
export const SCOPES = [
  'messages:send',
  'messages:receive',
  'messages:force',
  'fleet:read',
  'fleet:manage',
  'crew:assign',
  'crew:run',
  'labels:define',
  'labels:assign',
  'fleet:network',
  'scopes:declare',
  'scopes:grant',
] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/** The namespaces core reserves and enforces; every other one is a plugin's (decision 0046). */
export const CORE_NAMESPACES = ['messages', 'fleet', 'crew', 'labels', 'scopes'] as const;

/** A namespace or an action: lowercase letters, digits and hyphens, starting with a letter, 1 to 32 characters (decision 0046). */
const SCOPE_PART = '[a-z][a-z0-9-]{0,31}';
export const SCOPE_NAME_PATTERN = new RegExp(`^${SCOPE_PART}:${SCOPE_PART}$`);

/** Any scope a ship may hold, a core one or a plugin's: `<namespace>:<action>` (decision 0046). */
export type ScopeName = `${string}:${string}`;
export const scopeNameSchema = z.custom<ScopeName>((value) => typeof value === 'string' && SCOPE_NAME_PATTERN.test(value), { message: 'A scope is <namespace>:<action>' });

/**
 * The scopes commissioning may add to an agent ship, beside sending and
 * receiving, which every agent ship has (ADR 0002). `crew:assign` writes crew
 * request assignments; `crew:run` crews the ships whose requests are assigned
 * to its ship (decision 0029). `labels:define` defines labels and changes
 * their values; `labels:assign` assigns and unassigns the labels its ship owns
 * (decision 0031). `fleet:network` sets the fleet's network rules (decision
 * 0034).
 */
export const FLEET_SCOPES = ['fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network'] as const;
export const fleetScopeSchema = z.enum(FLEET_SCOPES);
export type FleetScope = z.infer<typeof fleetScopeSchema>;

/**
 * What a ship is (decision 0044): `argo` is the one `operator`, the console's
 * door is the `viewer`, an `agent` is a session, a `person` a human's ship
 * crewed by their own app or a chat, and an `app` an application or an
 * outside party, crewed by its adapter.
 */
export const SHIP_KINDS = ['operator', 'agent', 'viewer', 'person', 'app'] as const;
export const shipKindSchema = z.enum(SHIP_KINDS);
export type ShipKind = z.infer<typeof shipKindSchema>;

/** The kinds a commission makes; argo and the viewer ship come with the fleet. */
export const COMMISSIONED_SHIP_KINDS = ['agent', 'person', 'app'] as const;
export const commissionedShipKindSchema = z.enum(COMMISSIONED_SHIP_KINDS);
export type CommissionedShipKind = z.infer<typeof commissionedShipKindSchema>;

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
 * ship receives it; received when a push receive took it and has not handed
 * it to the agent yet; handed once the agent has it (a plain receive hands it
 * at once). Received and handed are in flight with the crew, until it is
 * acknowledged or returns to pending. After acknowledged, a pushed crew
 * reports it handled when the turn that took it ended by itself, or not
 * handled when that turn died twice.
 */
export const DELIVERY_STATES = [
  'pending',
  'received',
  'handed',
  'acknowledged',
  'handled',
  'notHandled',
  'undeliverable',
  'dismissed',
  'abandoned',
] as const;
export const deliveryStateSchema = z.enum(DELIVERY_STATES);
export type DeliveryState = z.infer<typeof deliveryStateSchema>;

/** The event types written so far. Each later slice adds the ones it writes. */
export const EVENT_TYPES = [
  'FleetInitialised',
  'ShipCommissioned',
  'OwnerSet',
  'OwnerChanged',
  'ShipClaimed',
  'LeaseRevoked',
  'CredentialRevoked',
  'StartingPromptIssued',
  'OperatorPasswordReset',
  'MessageAccepted',
  'LeasePushed',
  'DeliveryReceived',
  'DeliveryHanded',
  'DeliveryAcknowledged',
  'DeliveryHandled',
  'DeliveryNotHandled',
  'DeliveryOverdue',
  'DeliveryUndeliverable',
  'DeliveryReturned',
  'ShipRetired',
  'DeliveryAbandoned',
  'DeliveryDismissed',
  'ShipRenamed',
  'ShipReported',
  'StatementSet',
  'TurnReported',
  'SignInTicketIssued',
  'FleetLimitsChanged',
  'ViewerSessionStarted',
  'CrewRequested',
  'CrewRequestRemoved',
  'CrewAssigned',
  'CrewStatusChanged',
  'CrewRequestExplained',
  'CrewRequestGivenBack',
  'LabelDefined',
  'LabelValuesChanged',
  'LabelRetired',
  'LabelAssigned',
  'LabelUnassigned',
  'LabelDeleted',
  'WorktreeClearRequested',
  'WorktreeCleared',
  'WorktreeClearRemoved',
  'NetworkRulesSet',
  'NetworkRulesDeclared',
  'NetworkPluginRegistered',
  'NetworkPluginUnregistered',
  'BuiltInRuleChanged',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export * from './argo-message.js';
export * from './busy-wait.js';
export * from './mcp-url.js';
export * from './no-terminal-questions.js';

/**
 * How long a caller waits before each next call while the fleet answers busy
 * (`SERVICE_UNAVAILABLE`, nothing stored; docs/architecture.md): bounded and
 * longer each time, then the refusal stands. Each is drawn by `busyWaitMs`.
 */
export const FLEET_BUSY_WAITS_MS = [1000, 2000, 4000, 8000] as const;
