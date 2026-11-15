import type { ConsoleSessionOutput, FleetLimitsOutput } from '@aeolus-fleet/common';
import type { AppRouter } from '@aeolus-fleet/core';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { VIEWER_FLEET_ID } from '../../../lib/fixtures/report.fixtures';
import { HostedAccountUrlContext } from '../../../lib/hosted-account';
import { TRPCProvider } from '../../../lib/trpc';
import { FleetLimits } from './fleet-limits';

const ACCOUNT_URL = 'https://account.example.com/limits';
const LIMITS: FleetLimitsOutput = {
  ships: { count: 4, limit: 10 },
  dailyMessages: { count: 125, limit: 1000, resetsAt: '2026-11-16T00:00:00Z' },
  retention: { days: 30, keptFrom: null },
};

function aSession(kind: ConsoleSessionOutput['kind']): ConsoleSessionOutput {
  return {
    fleetId: VIEWER_FLEET_ID,
    fleetName: 'Demo fleet',
    expiresAt: '2026-11-16T00:00:00Z',
    kind,
    scopes: ['fleet:read'],
    featureFlags: [],
  };
}

/** The card with the session and limits already read, as on the overview. */
function Example({ kind, accountUrl }: { kind: ConsoleSessionOutput['kind']; accountUrl?: string }) {
  const [providers] = useState(() => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const trpcClient = createTRPCClient<AppRouter>({ links: [httpLink({ url: 'https://fleet.example.com/trpc' })] });
    const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
    queryClient.setQueryData(trpc.console.session.queryKey(), aSession(kind));
    queryClient.setQueryData(trpc.fleet.limits.queryKey(), LIMITS);
    return { queryClient, trpcClient };
  });
  return (
    <QueryClientProvider client={providers.queryClient}>
      <TRPCProvider queryClient={providers.queryClient} trpcClient={providers.trpcClient}>
        <HostedAccountUrlContext value={accountUrl}>
          <FleetLimits />
        </HostedAccountUrlContext>
      </TRPCProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Scenarios/Fleet/Limits',
  component: Example,
  args: { kind: 'viewer', accountUrl: ACCOUNT_URL },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ViewerKeepsMetersWithoutAccountLink: Story = {
  play: async ({ canvasElement }) => {
    // Given a demo viewer and a configured hosted account URL.
    const canvas = within(canvasElement);

    // When the overview's fleet limits card renders.
    const card = within(await canvas.findByRole('region', { name: 'Limits' }));

    // Then both meters and retention remain, with no account link.
    await expect(card.getByRole('meter', { name: 'Ships: 4 of 10' })).toBeVisible();
    await expect(card.getByRole('meter', { name: 'Messages today: 125 of 1000' })).toBeVisible();
    await expect(card.getByText('Finished history is kept for 30 days')).toBeVisible();
    await expect(card.queryByRole('link', { name: 'View limits' })).toBeNull();
  },
};

export const OperatorKeepsAccountLink: Story = {
  args: { kind: 'operator' },
  play: async ({ canvasElement }) => {
    // Given an operator session and a hosted account URL.
    const canvas = within(canvasElement);

    // When the limits card renders.
    const link = await canvas.findByRole('link', { name: 'View limits' });

    // Then the operator can still open the configured account.
    await expect(link).toHaveAttribute('href', ACCOUNT_URL);
  },
};

export const AccountKeepsAccountLink: Story = {
  ...OperatorKeepsAccountLink,
  args: { kind: 'account' },
};

export const NoHostedAccountHasNoLink: Story = {
  args: { kind: 'operator', accountUrl: undefined },
  play: async ({ canvasElement }) => {
    // Given an operator session with no hosted account URL.
    const canvas = within(canvasElement);

    // When the limits card renders.
    await canvas.findByRole('region', { name: 'Limits' });

    // Then there is no account link.
    await expect(canvas.queryByRole('link', { name: 'View limits' })).toBeNull();
  },
};
