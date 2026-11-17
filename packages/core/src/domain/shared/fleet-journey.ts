/** Durable fleet achievements, derived only from committed Registry and Messaging facts. */
import type { FleetJourneySummary, ShipId, ShipKind } from '@aeolus-fleet/common';

export interface FleetJourney extends Omit<FleetJourneySummary, 'activityDatesLast7Days' | 'activityDatesLast28Days'> {
  /** At most the first two distinct customer ships; enough to prove both crew milestones. Never exposed. */
  crewedShipIds: ShipId[];
}

export type JourneyFact =
  | { kind: 'crewed'; at: string; shipId: ShipId; shipKind: ShipKind }
  | { kind: 'message'; at: string; isQualifying: boolean; isRoundTrip: boolean };

/** The sole customer-ship rule: operational ship kinds never prove customer value. */
export function isCustomerShip(kind: ShipKind): boolean {
  return kind === 'agent' || kind === 'app';
}

const DAY_MS = 86_400_000;
export const JOURNEY_ACTIVITY_DAYS = 90;
const REPEAT_WINDOW_DAYS = 7;
const CATALOGUE = [
  { key: 'fleet-ready', label: 'Fleet ready', definitionVersion: 'v1' },
  { key: 'first-ship-crewed', label: 'First ship crewed', definitionVersion: 'v1' },
  { key: 'two-ships-crewed', label: 'Two ships crewed', definitionVersion: 'v1' },
  { key: 'first-message', label: 'First message', definitionVersion: 'v1' },
  { key: 'first-value', label: 'First value', definitionVersion: 'round-trip-v1' },
  { key: 'repeat-value', label: 'Repeat value', definitionVersion: 'round-trip-v1' },
] as const;

/** The first retained UTC date, inclusive. */
export function journeyActivitySince(now: Date, days = JOURNEY_ACTIVITY_DAYS): string {
  return new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

type JourneyKey = typeof CATALOGUE[number]['key'];

export function newFleetJourney(input: { createdAt: string; coverageFrom: string; computedAt: string }): FleetJourney {
  const isComplete = input.coverageFrom <= input.createdAt;
  return {
    coverageFrom: input.coverageFrom,
    computedAt: input.computedAt,
    processedThrough: 0,
    firstValueDefinition: { label: 'First value', version: 'round-trip-v1', definition: 'B replies with inReplyTo to A, back to A; both customer ships are crewed at each send.' },
    milestones: CATALOGUE.map((definition) => ({
      ...definition,
      occurredAt: definition.key === 'fleet-ready' ? input.createdAt : null,
      computedAt: input.computedAt,
      coverageFrom: definition.key === 'fleet-ready' ? input.createdAt : input.coverageFrom,
      state: definition.key === 'fleet-ready' ? 'reached' : isComplete ? 'not-yet' : 'unknown',
    })),
    crewedShipIds: [],
    activityDates: [],
    latestQualifyingActivityAt: null,
  };
}

/** Replays never rewrite achievements; bounded dates and the source watermark may advance. */
export function projectFleetJourney(state: FleetJourney, input: { facts: readonly JourneyFact[]; computedAt: string; processedThrough: number }): FleetJourney {
  if (input.processedThrough <= state.processedThrough) return state;
  let journey: FleetJourney = { ...state, computedAt: input.computedAt, processedThrough: input.processedThrough };
  const reach = (key: JourneyKey, at: string) => {
    journey = { ...journey, milestones: journey.milestones.map((fact) => fact.key !== key || fact.state === 'reached' ? fact : { ...fact, state: 'reached', occurredAt: at, computedAt: input.computedAt }) };
  };
  for (const fact of input.facts) {
    if (fact.kind === 'crewed' && isCustomerShip(fact.shipKind)) {
      if (journey.crewedShipIds.length < 2 && !journey.crewedShipIds.includes(fact.shipId)) journey = { ...journey, crewedShipIds: [...journey.crewedShipIds, fact.shipId] };
      reach('first-ship-crewed', fact.at);
      if (journey.crewedShipIds.length === 2) reach('two-ships-crewed', fact.at);
    }
    if (fact.kind !== 'message' || !fact.isQualifying) continue;
    reach('first-message', fact.at);
    journey = { ...journey,
      activityDates: [...new Set([...journey.activityDates, fact.at.slice(0, 10)])].toSorted(),
      latestQualifyingActivityAt: journey.latestQualifyingActivityAt === null || fact.at > journey.latestQualifyingActivityAt ? fact.at : journey.latestQualifyingActivityAt,
    };
    if (!fact.isRoundTrip) continue;
    reach('first-value', fact.at);
    const firstValue = journey.milestones.find((milestone) => milestone.key === 'first-value')?.occurredAt;
    if (firstValue && fact.at.slice(0, 10) > firstValue.slice(0, 10) && Date.parse(fact.at) - Date.parse(firstValue) <= REPEAT_WINDOW_DAYS * DAY_MS) reach('repeat-value', fact.at);
  }
  const cutoff = journeyActivitySince(new Date(input.computedAt));
  return { ...journey, activityDates: journey.activityDates.filter((date) => date >= cutoff) };
}

/** The installation sees no internal ship references, only bounded operational facts. */
export function fleetJourneySummary(state: FleetJourney, now: Date): FleetJourneySummary {
  const cutoff = journeyActivitySince(now);
  return { milestones: state.milestones, firstValueDefinition: state.firstValueDefinition,
    computedAt: state.computedAt, coverageFrom: state.coverageFrom, processedThrough: state.processedThrough,
    latestQualifyingActivityAt: state.latestQualifyingActivityAt,
    activityDates: state.activityDates.filter((date) => date >= cutoff),
    activityDatesLast7Days: state.activityDates.filter((date) => date >= journeyActivitySince(now, 7)),
    activityDatesLast28Days: state.activityDates.filter((date) => date >= journeyActivitySince(now, 28)),
  };
}
