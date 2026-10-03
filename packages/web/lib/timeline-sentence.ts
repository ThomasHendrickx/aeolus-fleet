import { isPingContentType, REPORT_STATES, type Party, type ReportState, type TimelineEntry } from '@aeolus-fleet/common';

import { locationKindWord } from './location';
import { REPORT_TONES } from './report';
import { capitalised, counted, ship, text, type SentencePart } from './sentence';

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


/** Whether a detail names a report state. */
function isReportState(value: string): value is ReportState {
  return REPORT_STATES.some((state) => state === value);
}

/** Who caused the event: " by argo"; nothing for the system. */
function by(actor: Party | null): SentencePart[] {
  return actor ? [text(' by '), ship(actor)] : [];
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

/** Whether the event concerns a ping: a message with the reserved ping content type. */
function isPing(entry: TimelineEntry): boolean {
  return entry.message !== null && isPingContentType(entry.message.contentType);
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
      : [text(`Sent a message to any ship of type ${sent.recipient.type}`)];
  }
  return [text('Received a message from '), ship(sent.sender)];
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
    case 'StartingPromptIssued':
      return { parts: [text('Starting prompt issued')], tone: 'ended', icon: 'prompt' };
    case 'ShipClaimed':
      return { parts: [text(`Claimed by a session on ${claimedWhere(entry)}`)], tone: 'ok', icon: 'claimed' };
    case 'LeaseRevoked':
      return { parts: [...leaseEnd(entry), ...returnedDeliveries(entry)], tone: 'waiting', icon: 'released' };
    case 'CredentialRevoked':
      return { parts: [text('Secret invalidated')], tone: 'ended', icon: 'secret' };
    case 'OperatorPasswordReset':
      return { parts: [text('Operator password reset')], tone: 'waiting', icon: 'password' };
    case 'MessageAccepted':
      return {
        parts: messageAccepted(entry, shipId),
        tone: 'ended',
        icon: entry.message?.sender.id === shipId ? 'sent' : 'received',
      };
    case 'DeliveryClaimed':
      return { parts: deliveryAct(entry, { shipId, verb: 'took' }), tone: 'active', icon: 'received' };
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
