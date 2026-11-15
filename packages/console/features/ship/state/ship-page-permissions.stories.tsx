import type { AppRouter } from '@aeolus-fleet/core';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { Toaster } from '@aeolus-fleet/ui';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { CREWED_SHIP } from '../../../lib/fixtures/ship-page.fixtures';
import { TRPCProvider } from '../../../lib/trpc';
import { ShipPagePermissions } from './ship-page-permissions';

/** A fleet HTTP boundary with independent reads and a delayed save. */
class Fleet {
  readonly queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  readonly manageAnswer = Promise.withResolvers<Response>();
  readonly saveAnswer = Promise.withResolvers<Response>();
  readonly retryAnswer = Promise.withResolvers<Response>();
  private catalogueReads = 0;
  constructor(private readonly hasCatalogueFailure = false) {}
  readonly scopes = ['messages:send', 'messages:receive', 'scopes:grant', 'fleet:read', 'meetings:open'];
  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('console.session')) return Response.json({ result: { data: { kind: 'account', scopes: this.scopes } } });
    if (url.pathname.endsWith('fleet.checkManage')) return this.manageAnswer.promise;
    if (url.pathname.endsWith('fleet.grantScopes')) return this.saveAnswer.promise;
    if (url.pathname.endsWith('fleet.scopes') && this.hasCatalogueFailure) {
      this.catalogueReads += 1;
      return this.catalogueReads === 1 ? Response.json({ error: { message: 'Could not read permissions', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }, { status: 500 }) : this.retryAnswer.promise;
    }
    if (url.pathname.endsWith('fleet.scopes')) return Response.json({ result: { data: [{ namespace: 'fleet', kind: 'core', declaredBy: null, scopes: [
      { scope: 'fleet:read', description: 'Read ships, timelines and messages.' },
      { scope: 'meetings:open', description: 'Invite ships to a meeting.' },
    ] }] } });
    throw new Error(`Unexpected procedure: ${url.pathname}`);
  };
  allowManage() { this.manageAnswer.resolve(Response.json({ result: { data: {} } })); }
  refuseManage() { this.manageAnswer.resolve(Response.json({ error: { message: 'Outside manage reach', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403, refusal: 'NOT_REACHABLE' } } }, { status: 403 })); }
}

function Example({ fleet }: { fleet: Fleet }) {
  const queryClient = fleet.queryClient;
  const [trpcClient] = useState(() => createTRPCClient<AppRouter>({ links: [httpLink({ url: 'https://fleet.example/trpc', fetch: fleet.fetch })] }));
  return <QueryClientProvider client={queryClient}><TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
    <ShipPagePermissions ship={CREWED_SHIP} /><Toaster />
  </TRPCProvider></QueryClientProvider>;
}
const meta = { title: 'Scenarios/Ship/Permissions authority', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ManageReadPending: Story = {
  args: { fleet: new Fleet() },
  play: async ({ args }) => {
    // Given the grant scope is known but manage reach has not answered.
    await screen.findByTestId('ship-permissions');
    // When the independent catalogue and session reads settle.
    await waitFor(async () => { await expect(args.fleet.queryClient.getQueriesData({ queryKey: [['console', 'session']] }).map(([, data]) => data)).toEqual([{ kind: 'account', scopes: args.fleet.scopes }]); });
    // Then an editor is not offered before the authority is known.
    await expect(screen.queryByTestId('ship-permissions-change')).toBeNull();
  },
};
export const OutsideManageReach: Story = {
  args: { fleet: new Fleet() },
  play: async ({ args }) => {
    // Given an account holding scopes:grant.
    await screen.findByTestId('ship-permissions');
    // When the server refuses manage reach on this ship.
    args.fleet.refuseManage();
    await waitFor(async () => { await expect(args.fleet.queryClient.getQueriesData({ queryKey: [['console', 'session']] }).map(([, data]) => data)).toEqual([{ kind: 'account', scopes: args.fleet.scopes }]); });
    // Then Change permissions is absent.
    await expect(screen.queryByTestId('ship-permissions-change')).toBeNull();
  },
};
export const WithinManageReach: Story = {
  args: { fleet: new Fleet() },
  play: async ({ args }) => {
    // Given an account holding scopes:grant.
    args.fleet.allowManage();
    // When the server confirms this ship is in manage reach.
    const change = await screen.findByTestId('ship-permissions-change');
    await userEvent.click(change);
    // Then it may edit only the scopes it can grant.
    await expect(await screen.findByRole('checkbox', { name: /Open a meeting/ })).toBeEnabled();
  },
};
export const SaveClosesEditor: Story = {
  args: { fleet: new Fleet() },
  play: async ({ args }) => {
    // Given an allowed editor with one new permission selected.
    args.fleet.allowManage();
    await userEvent.click(await screen.findByTestId('ship-permissions-change'));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Open a meeting/ }));
    // When saving waits for the fleet, then succeeds.
    await userEvent.click(screen.getByTestId('ship-permissions-save'));
    await expect(screen.getByTestId('ship-permissions-save')).toHaveAttribute('data-loading');
    args.fleet.saveAnswer.resolve(Response.json({ result: { data: { scopes: [...CREWED_SHIP.scopes, 'meetings:open'] } } }));
    // Then the completed action closes the editor and says what was saved.
    await waitFor(async () => { await expect(screen.queryByTestId('ship-permissions-save')).toBeNull(); });
    await waitFor(async () => { await expect(screen.getByText('Permissions saved for reviewer-01')).toBeVisible(); });
  },
};

export const RetryReadShowsPending: Story = {
  args: { fleet: new Fleet(true) },
  play: async ({ args }) => {
    // Given a failed catalogue read in an allowed editor.
    args.fleet.allowManage();
    await userEvent.click(await screen.findByTestId('ship-permissions-change'));
    await expect(await screen.findByText('Couldn’t read permissions')).toBeVisible();
    // When Try again is pressed before the fleet answers.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // Then the retry is visibly pending and cannot be pressed twice.
    const retry = await screen.findByRole('button', { name: /Trying again/ });
    await expect(retry).toHaveAttribute('data-loading');
    await expect(retry).toHaveAttribute('data-disabled');
  },
};
