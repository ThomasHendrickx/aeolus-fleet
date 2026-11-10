import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { Toaster } from '@aeolus-fleet/ui';
import { useMcpConfiguration } from '../hooks/use-mcp-configuration';
import type { McpConfiguration } from '../services/mcp-configuration';
import { McpServerDialog } from '../ui/organisms/mcp-server-dialog';
import { McpPanel } from '../ui/organisms/mcp-panel';

const CONFIGURATION: McpConfiguration = {
  version: 7,
  servers: [{ name: 'company-graph', url: 'https://graph.example.com/mcp', tools: ['query'], credential: { header: 'X-Api-Key', secret: 'graph-key' } }],
  secrets: ['graph-key'],
};

/** A delayed network boundary, never a mock of React, the query cache or the form. */
class McpPlugin {
  readonly saveAnswer = Promise.withResolvers<Response>();
  readonly readAnswer = Promise.withResolvers<Response>();
  readonly retryAnswer = Promise.withResolvers<Response>();
  readonly expectedVersions: unknown[] = [];
  readonly serverNames: unknown[][] = [];
  reads = 0;
  saves = 0;
  readonly fetch: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      this.saves += 1;
      if (typeof init.body !== 'string') throw new Error('The replacement body is JSON text');
      const input: unknown = JSON.parse(init.body);
      if (typeof input === 'object' && input !== null && 'expectedVersion' in input && 'servers' in input && Array.isArray(input.servers)) {
        this.expectedVersions.push(input.expectedVersion);
        this.serverNames.push(
          input.servers.map((server: unknown) => (typeof server === 'object' && server !== null && 'name' in server ? server.name : undefined)),
        );
      }
      return this.saves === 1 ? this.saveAnswer.promise : this.retryAnswer.promise;
    }
    this.reads += 1;
    return this.reads === 1 ? Response.json({ result: { data: CONFIGURATION } }) : this.readAnswer.promise;
  };
}

function SaveFlow({ plugin }: { plugin: McpPlugin }) {
  const mcp = useMcpConfiguration(true, plugin.fetch);
  const [isOpen, setIsOpen] = useState(true);
  const data = mcp.query.data;
  const nothing = () => undefined;
  return (
    <>
      <McpPanel configuration={data} onRetry={nothing} onEdit={nothing} onRemoveServer={nothing} onReplaceValue={nothing} onRemoveSecret={nothing} />
      {data === undefined || !isOpen ? null : (
        <McpServerDialog
          server={CONFIGURATION.servers[0]}
          secrets={data.secrets}
          version={data.version}
          isPending={mcp.isPending}
          isReading={mcp.isReading}
          error={mcp.error}
          onClose={() => {
            setIsOpen(false);
          }}
          onReadAgain={() => {
            void mcp.readAgain();
          }}
          onSave={(change) => {
            void mcp.save(change).then((isSaved) => {
              if (isSaved) setIsOpen(false);
            });
          }}
        />
      )}
      <Toaster />
    </>
  );
}
function Example({ plugin }: { plugin: McpPlugin }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SaveFlow plugin={plugin} />
    </QueryClientProvider>
  );
}
const meta = { title: 'Scenarios/Trierarchs/MCP save', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SaveShowsPendingThenVersion: Story = {
  args: { plugin: new McpPlugin() },
  play: async ({ args }) => {
    // Given an edit whose answer has not arrived.
    await screen.findByTestId('mcp-name');
    // When Save is pressed, then pending appears before the answer and every field and Cancel is disabled.
    await userEvent.click(screen.getByTestId('mcp-submit'));
    await expect(screen.getByTestId('mcp-submit')).toHaveAttribute('aria-busy', 'true');
    await expect(screen.getByTestId('mcp-name')).toBeDisabled();
    await expect(screen.getByTestId('mcp-cancel')).toBeDisabled();
    // And Add tool looks disabled like every other control, not only blocked by the fieldset.
    await expect(screen.getByTestId('mcp-add-tool')).toHaveAttribute('data-disabled');
    await waitFor(() => expect(screen.getByTestId('mcp-add-tool')).toHaveStyle({ opacity: '0.45' }));
    args.plugin.saveAnswer.resolve(Response.json({ result: { data: { version: 8 } } }));
    await waitFor(() => expect(screen.queryByTestId('mcp-form')).toBeNull());
    await expect(screen.getByText('Version 8')).toBeVisible();
    await waitFor(async () => {
      await expect(screen.getByText('Saved as version 8')).toBeVisible();
    });
    await expect(args.plugin.saves).toBe(1);
  },
};
export const ConflictReadsAgainAndKeepsInput: Story = {
  args: { plugin: new McpPlugin() },
  play: async ({ args }) => {
    // Given the manager edits while another manager saves first.
    const name = await screen.findByTestId('mcp-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'graph');
    // When saving is refused as stale, then the current set is read and the input stays.
    await userEvent.click(screen.getByTestId('mcp-submit'));
    args.plugin.saveAnswer.resolve(Response.json({ error: { message: 'The MCP configuration changed' } }, { status: 409 }));
    args.plugin.readAnswer.resolve(
      Response.json({
        result: {
          data: { ...CONFIGURATION, version: 8, servers: [...CONFIGURATION.servers, { name: 'docs', url: 'https://docs.example.com/mcp', tools: ['search'] }] },
        },
      }),
    );
    await screen.findByText('Someone else changed the MCP servers');
    await expect(name).toHaveValue('graph');
    await expect(screen.getByTestId('mcp-submit')).toHaveTextContent('Save again');
    await expect(screen.getByText('Version 8')).toBeVisible();
    await expect(args.plugin.saves).toBe(1);
    // When the manager saves again, then only their edit is rebased, retaining the other manager's server.
    await userEvent.click(screen.getByTestId('mcp-submit'));
    await waitFor(() => expect(args.plugin.saves).toBe(2));
    await expect(args.plugin.expectedVersions).toEqual([7, 8]);
    await expect(args.plugin.serverNames[1]).toEqual(['graph', 'docs']);
  },
};
export const NoAnswerRequiresExplicitRead: Story = {
  args: { plugin: new McpPlugin() },
  play: async ({ args }) => {
    // Given a write whose answer is lost.
    await screen.findByTestId('mcp-name');
    await userEvent.click(screen.getByTestId('mcp-submit'));
    args.plugin.saveAnswer.resolve(new Response(null, { status: 502 }));
    // When the outcome is unknown, then no automatic save or read runs.
    await screen.findByText('The trierarch plugin did not answer');
    await expect(screen.getByTestId('mcp-submit')).toBeDisabled();
    await expect(args.plugin.reads).toBe(1);
    await expect(args.plugin.saves).toBe(1);
    await userEvent.click(screen.getByTestId('mcp-read-again'));
    await expect(screen.getByTestId('mcp-read-again')).toHaveAttribute('aria-busy', 'true');
    args.plugin.readAnswer.resolve(Response.json({ result: { data: { ...CONFIGURATION, version: 8 } } }));
    await waitFor(() => expect(screen.getByTestId('mcp-submit')).toBeEnabled());
    await expect(screen.getByText('Version 8')).toBeVisible();
    await expect(args.plugin.saves).toBe(1);
  },
};
export const RefusalKeepsTheInput: Story = {
  args: { plugin: new McpPlugin() },
  play: async ({ args }) => {
    // Given an edit, when the plugin refuses it, then nothing changes and input remains.
    const name = await screen.findByTestId('mcp-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'graph');
    await userEvent.click(screen.getByTestId('mcp-submit'));
    args.plugin.saveAnswer.resolve(
      Response.json({ error: { message: 'graph: a credential header is an HTTP field name the proxy does not set itself' } }, { status: 400 }),
    );
    await screen.findByText('Couldn’t save the server');
    await expect(name).toHaveValue('graph');
    await expect(screen.getByTestId('mcp-submit')).toBeEnabled();
    await expect(screen.getByText('Version 7')).toBeVisible();
  },
};
