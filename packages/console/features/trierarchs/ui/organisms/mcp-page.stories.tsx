import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { Plus } from 'lucide-react';
import { Badge, Button, ToastCard } from '@aeolus-fleet/ui';
import { ConsoleFrame } from '../../../../components/organisms/console-frame';
import { ListPage } from '../../../../components/organisms/list-page';
import { AVATAR_MENU, SWITCHER } from '../../../../lib/fixtures/header.fixtures';
import { FLEET, MACHINES, NOW } from '../../../../lib/fixtures/machines.fixtures';
import { modelRowsOf } from '../../services/model-rows';
import type { McpConfiguration, McpServer } from '../../services/mcp-configuration';
import { TrierarchTabs } from '../molecules/trierarch-tabs';
import { MachineList } from './machine-list';
import { ModelsSection } from './models-section';
import { McpPanel } from './mcp-panel';
import { McpServerDialog } from './mcp-server-dialog';
import { McpSecretDialog } from './mcp-secret-dialog';
import { McpRemoveDialog } from './mcp-remove-dialog';
import type { McpSaveError } from './mcp-save-error';

const GRAPH: McpServer = {
  name: 'company-graph',
  url: 'https://graph.example.com/mcp',
  tools: ['query', 'neighbours', 'entity'],
  credential: { header: 'X-Api-Key', secret: 'graph-key' },
};
const CONFIGURATION: McpConfiguration = {
  version: 7,
  servers: [
    {
      name: 'aip',
      url: 'https://aip.example.com/mcp',
      tools: ['search_procedures', 'read_procedure', 'list_documents', 'read_document', 'list_owners'],
      credential: { header: 'Authorization', secret: 'aip-token' },
    },
    GRAPH,
    { name: 'docs-search', url: 'https://docs.example.com/mcp', tools: ['search'] },
  ],
  secrets: ['aip-token', 'graph-key', 'old-graph-key'],
};

type Frame =
  | 'ready'
  | 'today'
  | 'noPlugin'
  | 'machinesTab'
  | 'empty'
  | 'loading'
  | 'error'
  | 'serverMenu'
  | 'secretMenu'
  | 'add'
  | 'addNewSecret'
  | 'edit'
  | 'invalid'
  | 'saving'
  | 'refused'
  | 'tooLarge'
  | 'bodyTooLarge'
  | 'stale'
  | 'noAnswer'
  | 'saved'
  | 'removeServer'
  | 'replaceValue'
  | 'removeSecret';
const onAction = () => undefined;

/** Every approved frame uses the real props-only parts, with no plugin or secret store. */
function McpPageStory({ frame }: { frame: Frame }) {
  const isMachines = frame === 'today' || frame === 'machinesTab' || frame === 'noPlugin';
  const isNoPlugin = frame === 'noPlugin';
  const hasTabs = frame !== 'today' && !isNoPlugin;
  const version = frame === 'saved' || frame === 'stale' ? 8 : 7;
  const configuration = frame === 'loading' ? undefined : frame === 'empty' ? { version: 0, servers: [], secrets: [] } : { ...CONFIGURATION, version };
  const error: McpSaveError | undefined =
    frame === 'stale'
      ? { kind: 'stale', version: 8 }
      : frame === 'noAnswer'
        ? { kind: 'no-answer' }
        : frame === 'bodyTooLarge'
          ? { kind: 'body-too-large' }
          : frame === 'tooLarge'
            ? { kind: 'refused', message: 'the MCP configuration does not fit one message of 256 KB once sealed' }
            : frame === 'refused'
              ? { kind: 'refused', message: 'company-graph: a credential header is an HTTP field name the proxy does not set itself' }
              : undefined;
  const isServerForm = ['add', 'addNewSecret', 'edit', 'invalid', 'saving', 'refused', 'tooLarge', 'bodyTooLarge', 'stale', 'noAnswer'].includes(frame);
  const common = { isPending: frame === 'saving', onClose: onAction, onReadAgain: onAction, error };
  return (
    <>
      <ConsoleFrame
        nav={{
          active: 'trierarchs',
          inboxCount: 3,
          stuckCount: 2,
          hasSquadrons: true,
          hasTrierarchs: true,
          trierarchsCount: 1,
          hasNetwork: true,
          hasSettings: true,
        }}
      >
        <ListPage
          title="Trierarchs"
          titleMeta={isNoPlugin ? undefined : <Badge variant="outline">trierarch plugin 0.31.0</Badge>}
          description={
            isNoPlugin
              ? 'Not set up.'
              : isMachines
                ? 'Machines that run sessions for crew requests. The plugin picks a trierarch for each request.'
                : 'The MCP servers a crew request can name, and the secrets their credentials use.'
          }
          live="live"
          onCompose={onAction}
          onSearch={onAction}
          switcher={SWITCHER}
          account={AVATAR_MENU}
          primaryAction={
            isNoPlugin ? undefined : (
              <Button variant="primary" icon={<Plus aria-hidden />} disabled={frame === 'loading' || frame === 'error'} onClick={onAction}>
                {isMachines ? 'Join a machine' : 'Add server'}
              </Button>
            )
          }
        >
          {hasTabs ? <TrierarchTabs active={isMachines ? 'machines' : 'mcp'} /> : null}
          {isMachines ? (
            <>
              <MachineList
                connection={isNoPlugin ? 'none' : 'connected'}
                machines={isNoPlugin ? undefined : MACHINES}
                ships={FLEET}
                now={NOW}
                onRetry={onAction}
                onJoin={isNoPlugin ? undefined : onAction}
                onNewSetupLine={onAction}
              />
              {isNoPlugin ? null : <ModelsSection rows={modelRowsOf(MACHINES, [])} canManage onChange={onAction} onRetry={onAction} />}
            </>
          ) : (
            <McpPanel
              configuration={configuration}
              error={frame === 'error' ? 'The trierarch plugin did not answer: read mcp.get before replacing again' : undefined}
              onRetry={onAction}
              onEdit={onAction}
              onRemoveServer={onAction}
              onReplaceValue={onAction}
              onRemoveSecret={onAction}
            />
          )}
        </ListPage>
      </ConsoleFrame>
      {isServerForm ? (
        <McpServerDialog
          {...common}
          server={frame === 'add' || frame === 'addNewSecret' ? undefined : GRAPH}
          secrets={CONFIGURATION.secrets}
          version={version}
          onSave={onAction}
        />
      ) : null}
      {frame === 'replaceValue' ? <McpSecretDialog {...common} name="aip-token" usedBy={['aip']} onSave={onAction} /> : null}
      {frame === 'removeServer' ? <McpRemoveDialog {...common} name={GRAPH.name} server={GRAPH} onConfirm={onAction} /> : null}
      {frame === 'removeSecret' ? <McpRemoveDialog {...common} name="old-graph-key" onConfirm={onAction} /> : null}
      {frame === 'saved' ? (
        <div className="fixed right-6 bottom-6 z-50 max-sm:inset-x-3 max-sm:bottom-20">
          <ToastCard title="Saved as version 8" description="Machines apply it on their next pass." />
        </div>
      ) : null}
    </>
  );
}
const meta = {
  title: 'Pages/Trierarchs/MCP servers',
  component: McpPageStory,
  args: { frame: 'ready' },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof McpPageStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ canvas }) => {
    // Given the complete versioned set, when shown, then metadata and folded tools are accessible.
    await expect(canvas.getByText('Version 7')).toBeVisible();
    await expect(canvas.getByLabelText('read_document, list_owners')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Actions for company-graph' })).toBeVisible();
  },
};
export const Today: Story = {
  args: { frame: 'today' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('tab', { name: 'MCP servers' })).toBeNull();
  },
};
export const NoPlugin: Story = {
  args: { frame: 'noPlugin' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('The trierarch plugin is not set up for this fleet')).toBeVisible();
    await expect(canvas.queryByRole('tab')).toBeNull();
  },
};
export const MachinesTab: Story = { args: { frame: 'machinesTab' } };
export const Empty: Story = { args: { frame: 'empty' } };
export const Loading: Story = { args: { frame: 'loading' } };
export const ReadFailed: Story = { args: { frame: 'error' } };
export const ServerMenu: Story = {
  args: { frame: 'serverMenu' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for company-graph' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('menuitem', { name: 'Edit…' }) ?? screen.getByRole('button', { name: 'Edit' })).toBeVisible();
    });
  },
};
export const SecretMenu: Story = {
  args: { frame: 'secretMenu' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for old-graph-key' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('menuitem', { name: 'Remove…' }) ?? screen.getByRole('button', { name: 'Remove' })).toBeVisible();
    });
  },
};
export const UsedSecretMenu: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for aip-token' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('menuitem', { name: 'Replace value…' }) ?? screen.getByRole('button', { name: 'Replace value' })).toBeVisible();
    });
    await expect(screen.queryByRole('menuitem', { name: 'Remove…' })).toBeNull();
  },
};
export const Add: Story = { args: { frame: 'add' } };
export const AddNewSecret: Story = {
  args: { frame: 'addNewSecret' },
  play: async () => {
    const form = within(await screen.findByTestId('mcp-form'));
    await userEvent.click(form.getByTestId('mcp-credential'));
    await userEvent.click(form.getByTestId('mcp-secret'));
    await userEvent.click(await screen.findByRole('option', { name: 'New secret' }));
    await userEvent.type(form.getByTestId('mcp-secret-name'), 'docs-token');
    await userEvent.type(form.getByTestId('mcp-value'), 'example-write-only');
    await expect(form.getByTestId('mcp-value')).toHaveAttribute('type', 'password');
    await expect(form.queryByText('example-write-only')).toBeNull();
  },
};
export const Edit: Story = {
  args: { frame: 'edit' },
  play: async () => {
    const input = await screen.findByTestId('mcp-name');
    await userEvent.clear(input);
    await userEvent.type(input, 'graph');
    await expect(screen.getByText('Crew requests that name company-graph will not be placed until they name graph.')).toBeVisible();
  },
};
export const Invalid: Story = {
  args: { frame: 'invalid' },
  play: async () => {
    const input = await screen.findByTestId('mcp-name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Company Graph');
    await userEvent.click(screen.getByTestId('mcp-submit'));
    await expect(input).toHaveAttribute('aria-invalid', 'true');
  },
};
export const Saving: Story = {
  args: { frame: 'saving' },
  play: async () => {
    await expect(await screen.findByTestId('mcp-name')).toBeDisabled();
    await expect(screen.getByTestId('mcp-submit')).toHaveAttribute('aria-busy', 'true');
  },
};
export const Refused: Story = { args: { frame: 'refused' } };
export const TooLarge: Story = { args: { frame: 'tooLarge' } };
export const BodyTooLarge: Story = { args: { frame: 'bodyTooLarge' } };
export const Stale: Story = { args: { frame: 'stale' } };
export const NoAnswer: Story = {
  args: { frame: 'noAnswer' },
  play: async () => {
    await expect(await screen.findByTestId('mcp-submit')).toBeDisabled();
    await expect(screen.getByTestId('mcp-read-again')).toBeEnabled();
  },
};
export const Saved: Story = { args: { frame: 'saved' } };
export const RemoveServer: Story = { args: { frame: 'removeServer' } };
export const ReplaceValue: Story = {
  args: { frame: 'replaceValue' },
  play: async () => {
    const value = await screen.findByTestId('mcp-value');
    await userEvent.type(value, 'write-only-example-value');
    await expect(value).toHaveAttribute('type', 'password');
    await expect(screen.queryByText('write-only-example-value')).toBeNull();
  },
};
export const RemoveSecret: Story = { args: { frame: 'removeSecret' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
export const Desktop1440: Story = { parameters: { viewport: { defaultViewport: 'desktop1440' } } };
export const Desktop1920: Story = { parameters: { viewport: { defaultViewport: 'desktop1920' } } };
