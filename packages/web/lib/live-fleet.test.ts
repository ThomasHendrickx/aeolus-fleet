import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { isAttentionChange, isShipChange, liveStateOf, reloadQueries } from './live-fleet';

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
  ] as const)(
    'reloads the snapshot for %s',
    (type) => {
      expect(isShipChange(type)).toBe(true);
    },
  );

  it.each(['MessageAccepted', 'DeliveryClaimed', 'DeliveryReturned'] as const)(
    'leaves the snapshot alone for %s',
    (type) => {
      expect(isShipChange(type)).toBe(false);
    },
  );
});

describe('isAttentionChange', () => {
  it.each(['DeliveryUndeliverable', 'DeliveryDismissed'] as const)('reloads Needs attention for %s', (type) => {
    expect(isAttentionChange(type)).toBe(true);
  });

  it.each(['MessageAccepted', 'DeliveryClaimed', 'DeliveryAcknowledged', 'DeliveryAbandoned', 'ShipRetired'] as const)(
    'leaves Needs attention alone for %s',
    (type) => {
      expect(isAttentionChange(type)).toBe(false);
    },
  );
});

describe('reloadQueries', () => {
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
    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
    });

    // An event for a change committed after the first read began.
    const reloaded = reloadQueries(queryClient, ['fleet']);
    reads[0]?.('before the change');
    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    reads[1]?.('after the change');
    await reloaded;

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['fleet', 'inbox'])).toBe('after the change');
    });
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
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(['fleet', 'list'])).toBe('read 1');
    });

    await reloadQueries(queryClient, ['fleet']);

    expect(queryClient.getQueryData(['fleet', 'list'])).toBe('read 2');
    unsubscribe();
  });
});
