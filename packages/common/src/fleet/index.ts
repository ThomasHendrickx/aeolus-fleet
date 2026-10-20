import { z } from 'zod';

/**
 * The fleet's shared vocabulary (docs/blueprint.md, "Ubiquitous language"):
 * scopes, ship kinds, ship statuses, lease locations, selector kinds, delivery
 * states and event types. Core and console use the same words.
 */

/**
 * A core scope: a permission of a ship, stored on the server with the ship
 * and checked by core before every call. `messages:force` sends a forced
 * message, one that comes first (decision 0040); `fleet:on-behalf` reads on
 * behalf of a named ship (decision 0034); `scopes:declare` takes up a
 * plugin namespace and `scopes:grant` grants and revokes on a live ship
 * (decision 0046). `fleet:person`, `fleet:owner`, `fleet:explain`,
 * `fleet:connect` and `labels:any` are the jobs that were argo's alone
 * (decision 0053). `fleet:verify` writes verified facts (decision 0059).
 */
export const SCOPES = [
  'messages:send',
  'messages:receive',
  'messages:force',
  'messages:resend',
  'fleet:read',
  'fleet:commission',
  'fleet:manage',
  'crew:assign',
  'crew:run',
  'labels:define',
  'labels:assign',
  'fleet:network',
  'fleet:on-behalf',
  'fleet:person',
  'fleet:owner',
  'fleet:explain',
  'fleet:connect',
  'labels:any',
  'fleet:verify',
  'scopes:declare',
  'scopes:grant',
] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/** What each core scope allows, on one line (decision 0046). */
export const CORE_SCOPE_DESCRIPTIONS: Readonly<Record<Scope, string>> = {
  'messages:send': 'Send, answer and ask other ships',
  'messages:receive': 'Receive and confirm the deliveries to its own ship',
  'messages:force': 'Send a forced message, which comes first',
  'messages:resend': 'Resend or dismiss a stuck delivery of a message its ship reads',
  'fleet:read': 'Read ships, timelines, messages, labels, events and fleet-wide views',
  'fleet:commission': 'Commission agent ships, granting only what its ship may grant',
  'fleet:manage': 'Rename, release, recrew and retire the ships it manages; starting prompts, pings, crew requests and worktree clears',
  'crew:assign': 'Assign crew requests to trierarchs and explain why none fits',
  'crew:run': 'Crew the ships whose crew requests are assigned to its ship',
  'labels:define': 'Define labels, change their values and declare network rules on them',
  'labels:assign': 'Assign and unassign the values of labels its ship owns',
  'fleet:network': "The networking plugin's calls: the fleet's network rules",
  'fleet:on-behalf': "Read on behalf of a named ship, with that ship's read reach",
  'fleet:person': 'Commission person ships, each owning itself',
  'fleet:owner': 'Change the owner of the ships it manages',
  'fleet:explain': 'Explain reach and read the reach refusals of the ships it reads',
  'fleet:connect': 'Connect a plugin, which then reads every ship',
  'labels:any': 'Assign and unassign the values of any label on the ships it manages',
  'fleet:verify': 'Write and withdraw its verified facts about the ships it manages',
  'scopes:declare': 'Take up one plugin namespace and declare its scopes',
  'scopes:grant': 'Grant and revoke scopes on a live ship, within what its ship may grant',
};

/** The namespaces core reserves and enforces; every other one is a plugin's (decision 0046). */
export const CORE_NAMESPACES = ['messages', 'fleet', 'crew', 'labels', 'scopes'] as const;

/** A namespace or an action: lowercase letters, digits and hyphens, starting with a letter, 1 to 32 characters (decision 0046). */
const SCOPE_PART = '[a-z][a-z0-9-]{0,31}';
export const SCOPE_NAMESPACE_PATTERN = new RegExp(`^${SCOPE_PART}$`);
export const SCOPE_NAME_PATTERN = new RegExp(`^${SCOPE_PART}:${SCOPE_PART}$`);

/** The most scopes a plugin declares in its namespace (decision 0046). */
export const NAMESPACE_SCOPES_MAX = 20;
/** The longest one-line description of a declared scope. */
export const SCOPE_DESCRIPTION_MAX_LENGTH = 200;

/** Whether the namespace is one core reserves. */
export function isCoreNamespace(namespace: string): boolean {
  return CORE_NAMESPACES.some((core) => core === namespace);
}

/**
 * Any scope a ship may hold (decision 0046): `<namespace>:<action>`, a core
 * scope when its namespace is a core one, else a plugin's.
 */
export const scopeNameSchema = z
  .string()
  .regex(SCOPE_NAME_PATTERN, 'A scope is <namespace>:<action>')
  .refine((scope) => !isCoreNamespace(scope.slice(0, scope.indexOf(':'))) || scopeSchema.safeParse(scope).success, 'No such core scope');
export type ScopeName = z.infer<typeof scopeNameSchema>;

/**
 * The scopes commissioning may add to an agent ship, beside sending and
 * receiving, which every agent ship has (ADR 0002). `messages:resend`
 * resends or dismisses a stuck delivery; `fleet:commission` commissions
 * agent ships; `fleet:manage` manages the ships in its manage reach (decision
 * 0046). `crew:assign` writes crew
 * request assignments; `crew:run` crews the ships whose requests are assigned
 * to its ship (decision 0029). `labels:define` defines labels and changes
 * their values; `labels:assign` assigns and unassigns the labels its ship owns
 * (decision 0031). `fleet:network` sets the fleet's network rules (decision
 * 0034). `fleet:on-behalf` reads on behalf of a named ship (decision 0034).
 * The jobs that were argo's alone are scopes an agent ship can hold too
 * (decision 0053), and so is writing verified facts (decision 0059).
 */
export const FLEET_SCOPES = [
  'messages:resend',
  'fleet:read',
  'fleet:commission',
  'fleet:manage',
  'crew:assign',
  'crew:run',
  'labels:define',
  'labels:assign',
  'fleet:network',
  'fleet:on-behalf',
  'fleet:person',
  'fleet:owner',
  'fleet:explain',
  'fleet:connect',
  'labels:any',
  'fleet:verify',
] as const;
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
  'NetworkRulesDraftSaved',
  'NetworkRulesDraftDiscarded',
  // Written no more since the networking plugin went (decision 0034); the event log keeps them.
  'NetworkPluginRegistered',
  'NetworkPluginUnregistered',
  'BuiltInRuleChanged',
  'ScopesDeclared',
  'ScopesChanged',
  'PluginConnected',
  'PluginDisconnected',
  'VerifiedFactsSet',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export * from './argo-message.js';
export * from './busy-wait.js';
export * from './core-version.js';
export * from './mcp-url.js';
export * from './no-terminal-questions.js';

/**
 * How long a caller waits before each next call while the fleet answers busy
 * (`SERVICE_UNAVAILABLE`, nothing stored; docs/architecture.md): bounded and
 * longer each time, then the refusal stands. Each is drawn by `busyWaitMs`.
 */
export const FLEET_BUSY_WAITS_MS = [1000, 2000, 4000, 8000] as const;
