import type { Party, TimelineEntry } from '@aeolus-fleet/common';

import { locationKindWord } from './location';
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
  | 'password';

export interface TimelineSentence {
  parts: SentencePart[];
  tone: TimelineTone;
  icon: TimelineIcon;
}

function stringDetail(entry: TimelineEntry, name: string): string | undefined {
  const value = entry.details[name];
  return typeof value === 'string' ? value : undefined;
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

/** "a message from planner", or "a message" when the event names none. */
function aMessageFrom(entry: TimelineEntry): SentencePart[] {
  return entry.message ? [text('a message from '), ship(entry.message.sender)] : [text('a message')];
}

/** "A message from planner": the same, starting a sentence. */
function aMessageFromStarting(entry: TimelineEntry): SentencePart[] {
  return entry.message ? [text('A message from '), ship(entry.message.sender)] : [text('A message')];
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
      return { parts: deliveryAct(entry, { shipId, verb: 'acknowledged' }), tone: 'ok', icon: 'acknowledged' };
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
  }
}
