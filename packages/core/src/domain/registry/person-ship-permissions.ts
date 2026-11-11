/** Read and send rights stay separate even when they share an associated ship. */
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { DirectSendPermission, PersonShipReadFacts, PersonShipReadRefusal } from './person-ship-reads.js';
import { ruleMatchFilterOf, type RuleMatchFilter } from './rule-matches.js';

export function personShipReadPermission(facts: PersonShipReadFacts): Result<RuleMatchFilter, PersonShipReadRefusal> {
  if (facts.reader === null) {
    return refuse('LEASE_ENDED', 'The ship no longer has a usable identity');
  }
  if (!facts.scopes.includes('fleet:read')) {
    return refuse('SCOPE_NOT_HELD', 'This call needs the fleet:read scope');
  }
  return ok(ruleMatchFilterOf(facts.rules, { subject: facts.reader, verb: 'read' }));
}

export function personShipSendPermission(facts: PersonShipReadFacts): DirectSendPermission | null {
  const sender = facts.sender;
  if (sender?.scopes.includes('messages:send') !== true) {
    return null;
  }
  return { shipId: sender.ship.id, permission: ruleMatchFilterOf(facts.rules, { subject: sender.ship, verb: 'send' }) };
}
