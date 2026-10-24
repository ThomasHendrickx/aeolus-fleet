import type { Party, ReportState, TimelineEntry } from '@aeolus-fleet/common';

import { locationKindWord } from '../../../lib/location';
import { REPORT_TONES } from '../../../lib/report';
import { capitalised, counted, ship, text, type SentencePart } from '../../../lib/sentence';
import { recipientGroupWords } from '../../../lib/recipient';

/** The tone family of a timeline row's tile (docs/design/conventions.md, "Colour"). */
export type TimelineTone = 'waiting' | 'active' | 'ok' | 'attention' | 'ended';

/** The icon of a timeline row's tile, named for what happened; the organism maps it to a Lucide icon. */
export type TimelineIcon =
  | 'received'
  | 'sent'
  | 'claimed'
  | 'released'
  | 'prompt'
  | 'commissioned'
  | 'acknowledged'
  | 'returned'
  | 'undeliverable'
  | 'secret'
  | 'fleet'
  | 'password'
  | 'retired'
  | 'abandoned'
  | 'dismissed'
  | 'renamed'
  | 'reported';

export interface TimelineSentence {
  parts: SentencePart[];
  tone: TimelineTone;
  icon: TimelineIcon;
}

function stringDetail(entry: TimelineEntry, name: string): string | undefined {
  const value = entry.details[name];
  return typeof value === 'string' ? value : undefined;
}

/** The key of the label a label event names. */
function labelOf(entry: TimelineEntry): string {
  return stringDetail(entry, 'key') ?? '';
}

/** The values a label event lists, which its details carry comma separated. */
function valuesOf(entry: TimelineEntry): string {
  return (stringDetail(entry, 'values') ?? '').split(',').join(', ');
}

/** Whether a detail names a report state. */
function isReportState(value: string): value is ReportState {
  // REPORT_TONES has a tone for every report state, as its type requires.
  return Object.hasOwn(REPORT_TONES, value);
}

/** Who caused the event: " by argo"; nothing for the system. */
function by(actor: Party | null): SentencePart[] {
  return actor ? [text(' by '), ship(actor)] : [];
}

/** How a ship got its owner at commission (decision 0045). */
function ownerSetParts(entry: TimelineEntry): SentencePart[] {
  const how = stringDetail(entry, 'how');
  if (how === 'inherited') {
    return [text("Owner set: its commissioner's owner")];
  }
  return how === 'named' ? [text('Owner set: named'), ...by(entry.actor)] : [text('Owner set: argo by default')];
}

/** Where the claiming session runs: the description it reported, otherwise its kind. */
function claimedWhere(entry: TimelineEntry): string {
  const description = stringDetail(entry, 'locationDescription');
  if (description !== undefined && description !== '') {
    return description;
  }
  const kind = stringDetail(entry, 'location');
  return kind === 'DEVICE' || kind === 'CLOUD' || kind === 'SERVER' || kind === 'OTHER'
    ? locationKindWord(kind)
    : 'an unknown location';
}

/** How a lease end reads by its reason, other than a release, which names who released the ship. */
const LEASE_ENDS: Readonly<Record<string, string>> = {
  deregistered: 'Its session deregistered.',
  takenOver: 'Taken over by a new console session.',
  signedOut: 'The operator signed out.',
  passwordReset: 'Its session ended with the operator password reset.',
  accountCutOff: 'Its session ended: the account signed in as argo was cut off.',
  retired: 'Its session ended: the ship was retired.',
};

function leaseEnd(entry: TimelineEntry): SentencePart[] {
  const reason = stringDetail(entry, 'reason') ?? '';
  if (reason === 'released') {
    return [text('Released'), ...by(entry.actor), text('.')];
  }
  return [text(LEASE_ENDS[reason] ?? 'Its session ended.')];
}

function returnedDeliveries(entry: TimelineEntry): SentencePart[] {
  const count = entry.details.returnedDeliveries;
  const deliveries = { one: 'in-flight delivery', many: 'in-flight deliveries' };
  return typeof count === 'number' && count > 0
    ? [text(` ${counted(count, deliveries)} went back to pending.`)]
    : [];
}

/** Whether the event concerns a ping, as the server tells it. */
function isPing(entry: TimelineEntry): boolean {
  return entry.message?.isPing === true;
}

/** "a message from planner", "a ping from argo", or "a message" when the event names none. */
function aMessageFrom(entry: TimelineEntry): SentencePart[] {
  if (!entry.message) {
    return [text('a message')];
  }
  return [text(isPing(entry) ? 'a ping from ' : 'a message from '), ship(entry.message.sender)];
}

/** "A message from planner": the same, starting a sentence. */
function aMessageFromStarting(entry: TimelineEntry): SentencePart[] {
  const [first, ...rest] = aMessageFrom(entry);
  return first?.kind === 'text' ? [text(capitalised(first.text)), ...rest] : aMessageFrom(entry);
}

/**
 * A delivery event on the page of `shipId`: the page's ship did it ("Took a
 * message from planner"), or another ship did ("reviewer-02 took a message
 * from planner").
 */
function deliveryAct(entry: TimelineEntry, onPage: { shipId: string; verb: string }): SentencePart[] {
  const { shipId, verb } = onPage;
  const doer = entry.actor;
  const subject = doer === null || doer.id === shipId ? [text(capitalised(verb))] : [ship(doer), text(` ${verb}`)];
  return [...subject, text(' '), ...aMessageFrom(entry)];
}

function messageAccepted(entry: TimelineEntry, shipId: string): SentencePart[] {
  const sent = entry.message;
  if (!sent) {
    return [text('A message was sent')];
  }
  if (isPing(entry) && sent.recipient.kind === 'ship') {
    return sent.sender.id === shipId ? [text('Pinged '), ship(sent.recipient.ship)] : [text('Pinged by '), ship(sent.sender)];
  }
  if (sent.sender.id === shipId) {
    return sent.recipient.kind === 'ship'
      ? [text('Sent a message to '), ship(sent.recipient.ship)]
      : [text(`Sent a message to ${recipientGroupWords(sent.recipient)}`)];
  }
  return [text('Received a message from '), ship(sent.sender)];
}

/** Which of the 10 and 60 minute clocks ran out (decision 0040). */
function overdueReason(entry: TimelineEntry): string {
  const minutes = entry.details.minutes;
  const after = typeof minutes === 'number' ? `${String(minutes)} min` : 'too long';
  const clock = stringDetail(entry, 'clock');
  if (clock === 'notConfirmed') {
    return `handed, not confirmed for ${after}`;
  }
  return `waiting ${after} while its session is ${clock === 'busy' ? 'busy' : 'idle'}`;
}

/**
 * The one sentence, tone and icon of a timeline row
 * (docs/design/png/ShipTimeline.png), from the point of view of the ship whose
 * page it is.
 */
export function timelineSentence(entry: TimelineEntry, shipId: string): TimelineSentence {
  switch (entry.type) {
    case 'FleetInitialised':
      return { parts: [text('Fleet initialised')], tone: 'ended', icon: 'fleet' };
    case 'ShipCommissioned': {
      const type = stringDetail(entry, 'type');
      return {
        parts: [text('Commissioned'), ...by(entry.actor), ...(type === undefined ? [] : [text(` as ${type}`)])],
        tone: 'ended',
        icon: 'commissioned',
      };
    }
    case 'OwnerSet':
      return { parts: ownerSetParts(entry), tone: 'ended', icon: 'commissioned' };
    case 'OwnerChanged':
      return {
        parts: stringDetail(entry, 'why') === 'ownerRetired' ? [text('Owner retired: argo owns it now')] : [text('Owner changed'), ...by(entry.actor)],
        tone: 'ended',
        icon: 'renamed',
      };
    case 'StartingPromptIssued':
      return { parts: [text('Starting prompt issued')], tone: 'ended', icon: 'prompt' };
    case 'ShipClaimed':
      return { parts: [text(`Claimed by a session on ${claimedWhere(entry)}`)], tone: 'ok', icon: 'claimed' };
    case 'LeaseRevoked':
      return { parts: [...leaseEnd(entry), ...returnedDeliveries(entry)], tone: 'waiting', icon: 'released' };
    case 'CredentialRevoked':
      return { parts: [text('Secret invalidated')], tone: 'ended', icon: 'secret' };
    case 'OperatorLoginSet':
      return { parts: [text('Email and password set')], tone: 'waiting', icon: 'password' };
    case 'OperatorPasswordReset':
      return { parts: [text('Operator password reset')], tone: 'waiting', icon: 'password' };
    case 'FleetLimitsChanged':
      return { parts: [text('Fleet limits changed')], tone: 'ended', icon: 'fleet' };
    case 'SignInTicketIssued':
      return { parts: [text('Sign-in ticket issued')], tone: 'ended', icon: 'password' };
    case 'ViewerSessionStarted':
      return { parts: [text('Someone started viewing the fleet')], tone: 'ended', icon: 'password' };
    case 'CrewRequested':
      return { parts: [text('Crew requested'), ...by(entry.actor)], tone: 'waiting', icon: 'claimed' };
    case 'CrewRequestRemoved':
      return { parts: [text('Crew request removed'), ...by(entry.actor)], tone: 'ended', icon: 'released' };
    case 'CrewRequestExplained': {
      const reason = stringDetail(entry, 'reason');
      return {
        parts: [text(reason === undefined ? 'Crew request can not be placed yet' : `Crew request can not be placed: ${reason}`), ...by(entry.actor)],
        tone: 'waiting',
        icon: 'reported',
      };
    }
    case 'CrewRequestGivenBack': {
      const reason = stringDetail(entry, 'reason');
      return { parts: [text(reason === undefined ? 'Crew request given back' : `Crew request given back: ${reason}`), ...by(entry.actor)], tone: 'waiting', icon: 'released' };
    }
    case 'WorktreeClearRequested':
      return { parts: [text(`Clearing of the kept ${stringDetail(entry, 'repository') ?? ''} worktree requested`), ...by(entry.actor)], tone: 'waiting', icon: 'reported' };
    case 'WorktreeCleared':
      return {
        parts: [
          text(
            stringDetail(entry, 'outcome') === 'not-kept'
              ? `Kept ${stringDetail(entry, 'repository') ?? ''} worktree cleared (none was kept)`
              : `Kept ${stringDetail(entry, 'repository') ?? ''} worktree cleared`,
          ),
          ...by(entry.actor),
        ],
        tone: 'ended',
        icon: 'retired',
      };
    case 'WorktreeClearRemoved':
      return { parts: [text(`Clearing of the kept ${stringDetail(entry, 'repository') ?? ''} worktree dropped`), ...by(entry.actor)], tone: 'ended', icon: 'released' };
    case 'CrewAssigned':
      return { parts: [text('Crew request assigned'), ...by(entry.actor)], tone: 'waiting', icon: 'claimed' };
    case 'CrewStatusChanged': {
      const status = stringDetail(entry, 'status');
      return {
        parts: [text(status === undefined ? 'Crew status changed' : `Crew ${status}`), ...by(entry.actor)],
        tone: status === 'crashed' ? 'attention' : 'active',
        icon: 'reported',
      };
    }
    case 'LabelDefined':
      return { parts: [text(`Label ${labelOf(entry)} defined: ${valuesOf(entry)}`)], tone: 'ended', icon: 'reported' };
    case 'LabelValuesChanged':
      return { parts: [text(`Label ${labelOf(entry)} values changed: ${valuesOf(entry)}`)], tone: 'ended', icon: 'reported' };
    case 'LabelRetired':
      return { parts: [text(`Label ${labelOf(entry)} retired`)], tone: 'ended', icon: 'retired' };
    case 'NetworkRulesSet': {
      const rules = entry.details.rules;
      const version = String(entry.details.version ?? '');
      const set = typeof rules === 'number' ? `Network rules set: ${String(rules)} rules` : 'Network rules cleared: every ship reaches every ship';
      return { parts: [text(`${set}, version ${version}`), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    }
    case 'NetworkRulesDraftSaved': {
      const rules = entry.details.rules;
      const drafted = typeof rules === 'number' ? `${String(rules)} rules` : 'every ship reaches every ship';
      return { parts: [text(`Network rules draft saved: ${drafted}, against version ${String(entry.details.savedAgainstVersion ?? '')}`), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    }
    case 'NetworkRulesDraftDiscarded':
      return { parts: [text('Network rules draft discarded'), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    case 'NetworkRulesDeclared': {
      const rules = entry.details.rules;
      const declared = typeof rules === 'number' && rules > 0 ? `Network rules declared: ${String(rules)} rules` : 'Declared network rules withdrawn';
      return { parts: [text(declared), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    }
    case 'ScopesDeclared': {
      const scopes = typeof entry.details.scopes === 'number' ? entry.details.scopes : 0;
      return {
        parts: [text(`Scopes declared: namespace ${stringDetail(entry, 'namespace') ?? ''}, ${String(scopes)} ${scopes === 1 ? 'scope' : 'scopes'}`), ...by(entry.actor)],
        tone: 'ended',
        icon: 'fleet',
      };
    }
    case 'ScopesChanged': {
      const granted = stringDetail(entry, 'added') ?? '';
      const revoked = stringDetail(entry, 'removed') ?? '';
      const changes = [...(granted === '' ? [] : [`granted ${granted}`]), ...(revoked === '' ? [] : [`revoked ${revoked}`])];
      return { parts: [text(`Scopes changed: ${changes.join(', ')}`), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    }
    case 'PluginConnected':
      return { parts: [text('Connected as a plugin: reads every ship'), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    case 'PluginDisconnected':
      return { parts: [text(`No longer a connected plugin: ${stringDetail(entry, 'why') ?? ''}`), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    case 'MeetingOpened': {
      const participants = entry.details.participants;
      return { parts: [text(`Opened a meeting of ${typeof participants === 'number' ? counted(participants, { one: 'ship', many: 'ships' }) : 'ships'}`)], tone: 'ok', icon: 'sent' };
    }
    case 'ParticipantAdded':
      return { parts: [text('Joined a meeting'), ...(entry.actor ? [text(', added by '), ship(entry.actor)] : [])], tone: 'ok', icon: 'received' };
    case 'MicRequested':
      return { parts: [text('Requested the mic in a meeting')], tone: 'ok', icon: 'sent' };
    case 'MicRequestWithdrawn':
      return { parts: [text('Withdrew its mic request in a meeting')], tone: 'ok', icon: 'sent' };
    case 'MicGiven':
      return {
        parts: entry.details.pattern === 'fifo' ? [text('Got the mic in a meeting, first in line')] : [text('Got the mic in a meeting'), ...(entry.actor ? [text(', given by '), ship(entry.actor)] : [])],
        tone: 'ok',
        icon: 'received',
      };
    case 'MicReleased':
      return { parts: [text('Released the mic in a meeting')], tone: 'ok', icon: 'sent' };
    case 'MicTaken':
      return { parts: [text('Lost the mic in a meeting'), ...(entry.actor ? [text(', taken by '), ship(entry.actor)] : [])], tone: 'ok', icon: 'received' };
    case 'MicPatternSet':
      return { parts: [text(entry.details.pattern === 'fifo' ? "Set a meeting's mic to first in line" : "Set a meeting's mic to the moderator's pick")], tone: 'ok', icon: 'sent' };
    case 'VerifiedFactsRemoved':
      return {
        parts: [text(`Verified facts removed: ${String(entry.details.facts ?? '')}, ${stringDetail(entry, 'why') === 'writerRetired' ? 'their writer retired' : 'the ship retired'}`)],
        tone: 'ended',
        icon: 'reported',
      };
    case 'VerifiedFactsSet': {
      const facts = entry.details.facts;
      return {
        parts: [text(facts === 0 ? 'Verified facts withdrawn' : `Verified facts set: ${String(facts ?? '')}`), ...by(entry.actor)],
        tone: 'ended',
        icon: 'reported',
      };
    }
    case 'NetworkPluginRegistered':
      return {
        parts: [text(`Networking plugin registered: while unavailable ${stringDetail(entry, 'whileUnavailable') ?? ''}, version ${String(entry.details.version ?? '')}`), ...by(entry.actor)],
        tone: 'ended',
        icon: 'fleet',
      };
    case 'NetworkPluginUnregistered':
      return {
        parts: [text(`Networking plugin unregistered: every ship reaches every ship, version ${String(entry.details.version ?? '')}`), ...by(entry.actor)],
        tone: 'ended',
        icon: 'fleet',
      };
    case 'BuiltInRuleChanged': {
      const verb = stringDetail(entry, 'verb');
      const rule = entry.details.rule === 'viewerRead' ? 'viewer read' : `${stringDetail(entry, 'rule') ?? ''}${verb === undefined ? '' : ` for ${verb}`}`;
      const turned = entry.details.isOn === true ? 'on' : 'off';
      return { parts: [text(`Built-in rule ${rule} turned ${turned}, version ${String(entry.details.version ?? '')}`), ...by(entry.actor)], tone: 'ended', icon: 'fleet' };
    }
    case 'LabelDeleted':
      return { parts: [text(`Label ${labelOf(entry)} deleted`)], tone: 'ended', icon: 'retired' };
    case 'LabelAssigned':
      return { parts: [text(`Labelled ${labelOf(entry)}=${stringDetail(entry, 'value') ?? ''}`), ...by(entry.actor)], tone: 'ended', icon: 'reported' };
    case 'LabelUnassigned':
      return { parts: [text(`Label ${labelOf(entry)}=${stringDetail(entry, 'value') ?? ''} removed`), ...by(entry.actor)], tone: 'ended', icon: 'reported' };
    case 'MessageAccepted':
      return {
        parts: messageAccepted(entry, shipId),
        tone: 'ended',
        icon: entry.message?.sender.id === shipId ? 'sent' : 'received',
      };
    case 'LeasePushed':
      return { parts: [text('Pushed: its trierarch or plugin watcher receives for its session')], tone: 'ok', icon: 'received' };
    case 'DeliveryReceived':
      return {
        parts: deliveryAct(entry, { shipId, verb: entry.details.again === true ? 'received again' : 'received' }),
        tone: 'active',
        icon: 'received',
      };
    case 'DeliveryHanded':
      return {
        parts: deliveryAct(entry, { shipId, verb: entry.details.onceMore === true ? 'took once more' : 'took' }),
        tone: 'active',
        icon: 'received',
      };
    case 'DeliveryHandled':
      return { parts: deliveryAct(entry, { shipId, verb: 'handled' }), tone: 'ok', icon: 'acknowledged' };
    case 'DeliveryNotHandled':
      return {
        parts: [...aMessageFromStarting(entry), text(' was not handled: its turn died twice')],
        tone: 'attention',
        icon: 'undeliverable',
      };
    case 'DeliveryOverdue':
      return { parts: [...aMessageFromStarting(entry), text(` is overdue: ${overdueReason(entry)}, argo told`)], tone: 'attention', icon: 'undeliverable' };
    case 'DeliveryAcknowledged':
      return {
        parts:
          stringDetail(entry, 'answer') === 'pong'
            ? [...deliveryAct(entry, { shipId, verb: 'answered' }), text(' with pong')]
            : deliveryAct(entry, { shipId, verb: 'acknowledged' }),
        tone: 'ok',
        icon: 'acknowledged',
      };
    case 'DeliveryReturned':
      return {
        parts: [...aMessageFromStarting(entry), text(' went back to pending')],
        tone: 'waiting',
        icon: 'returned',
      };
    case 'DeliveryUndeliverable':
      return {
        parts: [...aMessageFromStarting(entry), text(' became undeliverable')],
        tone: 'attention',
        icon: 'undeliverable',
      };
    case 'ShipRetired': {
      const count = entry.details.abandonedDeliveries;
      const deliveries = { one: 'delivery', many: 'deliveries' };
      return {
        parts: [
          text('Retired'),
          ...by(entry.actor),
          text('.'),
          ...(typeof count === 'number' && count > 0 ? [text(` ${counted(count, deliveries)} abandoned.`)] : []),
        ],
        tone: 'ended',
        icon: 'retired',
      };
    }
    case 'DeliveryAbandoned':
      return { parts: [...aMessageFromStarting(entry), text(' was abandoned')], tone: 'ended', icon: 'abandoned' };
    case 'ShipReported': {
      const state = stringDetail(entry, 'state') ?? 'in';
      const note = stringDetail(entry, 'note');
      return {
        parts: [text(note === undefined ? `Reported ${state}` : `Reported ${state}: ${note}`)],
        tone: isReportState(state) ? REPORT_TONES[state] : 'ended',
        icon: 'reported',
      };
    }
    case 'StatementSet':
      return {
        parts: [text(`Stated what it is and offers: ${String(entry.details.capabilities ?? '')} capabilities, version ${String(entry.details.version ?? '')}`)],
        tone: 'ended',
        icon: 'reported',
      };
    case 'TurnReported': {
      const turn = stringDetail(entry, 'turn');
      return { parts: [text(turn === 'busy' ? 'Turn started: busy' : 'Turn ended: idle')], tone: turn === 'busy' ? 'active' : 'ended', icon: 'reported' };
    }
    case 'ShipRenamed': {
      const from = stringDetail(entry, 'from');
      const to = stringDetail(entry, 'to');
      return {
        parts: [text(from === undefined || to === undefined ? 'Renamed' : `Renamed from ${from} to ${to}`), ...by(entry.actor)],
        tone: 'ended',
        icon: 'renamed',
      };
    }
    case 'DeliveryDismissed':
      return {
        parts: [...aMessageFromStarting(entry), text(' was dismissed'), ...by(entry.actor)],
        tone: 'ended',
        icon: 'dismissed',
      };
  }
}
