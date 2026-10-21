import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createLiveReloads, isAttentionChange, isBuiltInRulesChange, isDeclaredRulesChange, isLabelChange, isNetworkRulesChange, isShipChange, liveStateOf } from './live-fleet';

describe('liveStateOf', () => {
  it.each([
    ['pending', 'live'],
    ['connecting', 'reconnecting'],
    ['idle', 'offline'],
    ['error', 'offline'],
  ] as const)('words a %s subscription as %s', (status, live) => {
    expect(liveStateOf(status)).toBe(live);
  });
});

describe('isShipChange', () => {
  it.each([
    'ShipCommissioned',
    'ShipClaimed',
    'LeaseRevoked',
    'CredentialRevoked',
    'StartingPromptIssued',
    'ShipRetired',
    'DeliveryAcknowledged',
    'DeliveryUndeliverable',
    'ShipReported',
    'LabelAssigned',
    'LabelUnassigned',
    'LabelRetired',
  ] as const)(
    'reloads the snapshot for %s',
    (type) => {
      expect(isShipChange(type)).toBe(true);
    },
  );

  it.each(['MessageAccepted', 'DeliveryHanded', 'DeliveryReturned'] as const)(
    'leaves the snapshot alone for %s',
    (type) => {
      expect(isShipChange(type)).toBe(false);
    },
  );
});

describe('isLabelChange', () => {
  it.each(['LabelDefined', 'LabelValuesChanged', 'LabelRetired', 'LabelAssigned', 'LabelUnassigned', 'LabelDeleted'] as const)('reloads the labels for %s', (type) => {
    expect(isLabelChange(type)).toBe(true);
  });

  it.each(['ShipCommissioned', 'ShipRetired', 'MessageAccepted'] as const)('leaves the labels alone for %s', (type) => {
    expect(isLabelChange(type)).toBe(false);
  });
});

describe('isAttentionChange', () => {
  it.each(['DeliveryUndeliverable', 'DeliveryNotHandled', 'DeliveryDismissed'] as const)('reloads Needs attention for %s', (type) => {
    expect(isAttentionChange(type)).toBe(true);
  });

  it.each([
    'MessageAccepted',
    'LeasePushed',
    'DeliveryReceived',
    'DeliveryHanded',
    'DeliveryAcknowledged',
    'DeliveryHandled',
    'DeliveryOverdue',
    'DeliveryReturned',
    'TurnReported',
    'DeliveryAbandoned',
    'ShipRetired',
  ] as const)(
    'leaves Needs attention alone for %s',
    (type) => {
      expect(isAttentionChange(type)).toBe(false);
    },
  );
});

describe('isDeclaredRulesChange', () => {
  it('reloads the declared rules for NetworkRulesDeclared', () => {
    expect(isDeclaredRulesChange('NetworkRulesDeclared')).toBe(true);
  });

  it.each(['NetworkRulesSet', 'LabelRetired', 'ShipRetired', 'MessageAccepted'] as const)('leaves the declared rules alone for %s', (type) => {
    expect(isDeclaredRulesChange(type)).toBe(false);
  });
});

describe('isBuiltInRulesChange', () => {
  it.each(['BuiltInRuleChanged', 'NetworkRulesSet'] as const)('reloads the built-in rules for %s, which turns one on or off', (type) => {
    expect(isBuiltInRulesChange(type)).toBe(true);
  });

  it.each(['NetworkRulesDraftSaved', 'NetworkRulesDeclared', 'MessageAccepted'] as const)('leaves the built-in rules alone for %s', (type) => {
    expect(isBuiltInRulesChange(type)).toBe(false);
  });
});

describe('isNetworkRulesChange', () => {
  it.each(['NetworkRulesSet', 'NetworkRulesDraftSaved', 'NetworkRulesDraftDiscarded', 'NetworkRulesDeclared', 'BuiltInRuleChanged'] as const)(
    'reloads the network rules, what the draft changes and the reach for %s',
    (type) => {
      expect(isNetworkRulesChange(type)).toBe(true);
    },
  );

  it.each(['LabelAssigned', 'MessageAccepted'] as const)('leaves them alone for %s', (type) => {
    expect(isNetworkRulesChange(type)).toBe(false);
  });
});

describe('live reloads', () => {
  it('reads again after an event that comes while the first read is in flight, which may have read before the change', async () => {
    const queryClient = new QueryClient();
    const reads: ((value: string) => void)[] = [];
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'inbox'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          reads.push(resolve);
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => reads).toHaveLength(1);

    // An event for a change committed after the first read began.
    createLiveReloads(queryClient)(['fleet']);
    reads[0]?.('before the change');
    await expect.poll(() => reads).toHaveLength(2);
    reads[1]?.('after the change');

    await expect.poll(() => queryClient.getQueryData(['fleet', 'inbox'])).toBe('after the change');
    unsubscribe();
  });

  it('reads again a query that already has data, as an invalidation does', async () => {
    const queryClient = new QueryClient();
    let reads = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'list'],
      queryFn: () => {
        reads += 1;
        return Promise.resolve(`read ${String(reads)}`);
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('read 1');

    createLiveReloads(queryClient)(['fleet']);

    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('read 2');
    unsubscribe();
  });

  it('keeps one read of a query in flight for a burst of events, and reads once more after it for the events that came meanwhile (#1027)', async () => {
    const queryClient = new QueryClient();
    const reads: ((value: string) => void)[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['fleet', 'list'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          reads.push((value) => {
            inFlight -= 1;
            resolve(value);
          });
        }),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await expect.poll(() => reads).toHaveLength(1);
    reads[0]?.('first');
    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('first');
    const reload = createLiveReloads(queryClient);

    reload(['fleet']);
    await expect.poll(() => reads).toHaveLength(2);
    for (let event = 0; event < 25; event += 1) {
      reload(['fleet']);
    }
    reads[1]?.('during the burst');
    await expect.poll(() => reads).toHaveLength(3);
    reads[2]?.('after the burst');

    await expect.poll(() => queryClient.getQueryData(['fleet', 'list'])).toBe('after the burst');
    expect(reads).toHaveLength(3);
    expect(mostInFlight).toBe(1);
    unsubscribe();
  });
});
