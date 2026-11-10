'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button } from '@aeolus-fleet/ui';
import { ListPage } from '../../../components/organisms/list-page';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useAccess } from '../../../lib/access';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useTrierarchPluginConnection, useTrierarchPluginVersion } from '../../../lib/trierarch-plugin';
import { useMcpConfiguration } from '../hooks/use-mcp-configuration';
import type { McpChange, McpServer } from '../services/mcp-configuration';
import { TrierarchTabs } from '../ui/molecules/trierarch-tabs';
import { MachineList } from '../ui/organisms/machine-list';
import { McpPanel } from '../ui/organisms/mcp-panel';
import { lazyDialog } from '../../../lib/lazy-dialog';

const McpServerDialog = lazyDialog(
  () => import('../ui/organisms/mcp-server-dialog').then((module) => module.McpServerDialog),
  () => true,
);
const McpSecretDialog = lazyDialog(
  () => import('../ui/organisms/mcp-secret-dialog').then((module) => module.McpSecretDialog),
  () => true,
);
const McpRemoveDialog = lazyDialog(
  () => import('../ui/organisms/mcp-remove-dialog').then((module) => module.McpRemoveDialog),
  () => true,
);

type Dialog =
  | { kind: 'server'; server?: McpServer }
  | { kind: 'value'; name: string }
  | { kind: 'remove-server'; server: McpServer }
  | { kind: 'remove-secret'; name: string };

/** The manager's MCP route composes metadata, forms and the existing console door. */
export function McpContainer() {
  const frame = useConsoleFrame();
  const access = useAccess();
  const connection = useTrierarchPluginConnection();
  const pluginVersion = useTrierarchPluginVersion();
  const liveFleet = useLiveFleet();
  const canManage = access.canManage && connection !== 'none' && connection !== 'unknown';
  const mcp = useMcpConfiguration(canManage);
  const [dialog, setDialog] = useState<Dialog>();
  const open = (next: Dialog) => {
    mcp.reset();
    setDialog(next);
  };
  const close = () => {
    setDialog(undefined);
    mcp.reset();
  };
  const save = async (change: McpChange) => {
    if (await mcp.save(change)) setDialog(undefined);
  };
  const common = {
    isPending: mcp.isPending,
    error: mcp.error,
    isReading: mcp.isReading,
    onReadAgain: () => {
      void mcp.readAgain();
    },
    onClose: close,
  };
  const configuration = mcp.query.data;
  return (
    <ListPage
      {...frame}
      title="Trierarchs"
      titleMeta={pluginVersion === undefined ? undefined : <Badge variant="outline">trierarch plugin {pluginVersion}</Badge>}
      description={connection === 'none' ? 'Not set up.' : 'The MCP servers a crew request can name, and the secrets their credentials use.'}
      live={liveFleet.live}
      primaryAction={
        canManage ? (
          <Button
            variant="primary"
            icon={<Plus aria-hidden />}
            disabled={configuration === undefined}
            onClick={() => {
              open({ kind: 'server' });
            }}
            data-testid="mcp-add-server"
          >
            Add server
          </Button>
        ) : undefined
      }
    >
      {canManage ? <TrierarchTabs active="mcp" /> : null}
      {connection === 'none' ? (
        <MachineList connection="none" machines={undefined} ships={[]} now={new Date()} onRetry={() => undefined} />
      ) : canManage ? (
        <McpPanel
          isRetrying={mcp.query.isFetching}
          configuration={configuration}
          error={mcp.query.isError ? mcp.query.error.message : undefined}
          onRetry={() => {
            void mcp.query.refetch();
          }}
          onEdit={(server) => {
            open({ kind: 'server', server });
          }}
          onRemoveServer={(server) => {
            open({ kind: 'remove-server', server });
          }}
          onReplaceValue={(name) => {
            open({ kind: 'value', name });
          }}
          onRemoveSecret={(name) => {
            open({ kind: 'remove-secret', name });
          }}
        />
      ) : null}
      {configuration === undefined || !canManage ? null : (
        <>
          {dialog?.kind === 'server' ? (
            <McpServerDialog
              {...common}
              server={dialog.server}
              secrets={configuration.secrets}
              version={configuration.version}
              onSave={(change) => {
                void save(change);
              }}
            />
          ) : null}
          {dialog?.kind === 'value' ? (
            <McpSecretDialog
              {...common}
              name={dialog.name}
              usedBy={configuration.servers.filter((server) => server.credential?.secret === dialog.name).map((server) => server.name)}
              onSave={(value) => {
                void save({ kind: 'value', name: dialog.name, value });
              }}
            />
          ) : null}
          {dialog?.kind === 'remove-server' ? (
            <McpRemoveDialog
              {...common}
              name={dialog.server.name}
              server={dialog.server}
              onConfirm={() => {
                void save({ kind: 'remove-server', name: dialog.server.name });
              }}
            />
          ) : null}
          {dialog?.kind === 'remove-secret' ? (
            <McpRemoveDialog
              {...common}
              name={dialog.name}
              onConfirm={() => {
                void save({ kind: 'remove-secret', name: dialog.name });
              }}
            />
          ) : null}
        </>
      )}
    </ListPage>
  );
}
