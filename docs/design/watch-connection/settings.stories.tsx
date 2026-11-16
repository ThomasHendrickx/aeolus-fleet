/** Static design boards only. No plugin calls, secrets, persistence or connection handlers. */
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Link2 } from 'lucide-react';
import { Button, InlineError, LoadingSkeleton } from '@aeolus-fleet/ui';
import { ConsoleFrame } from '../../../packages/console/components/organisms/console-frame';
import { ListPage } from '../../../packages/console/components/organisms/list-page';
import { GatewayConnection } from '../../../packages/console/features/settings/ui/organisms/gateway-connection';
import { SquadronsConnection } from '../../../packages/console/features/settings/ui/organisms/squadrons-connection';
import { TrierarchPluginConnection } from '../../../packages/console/features/settings/ui/organisms/trierarch-plugin-connection';
import { TemplateRepositories } from '../../../packages/console/features/settings/ui/organisms/template-repositories';
import { MissingScopes as MissingScopesPart } from '../../../packages/console/features/settings/ui/molecules/missing-scopes';
import { FailedScopesRead } from '../../../packages/console/features/settings/ui/molecules/failed-scopes-read';
import { AVATAR_MENU, SWITCHER } from '../../../packages/console/lib/fixtures/header.fixtures';
import type { ShownConnection } from '../../../packages/console/lib/shown-connection';

const noop = () => undefined;
const retry = () => Promise.resolve();
const actions = { onRetry: retry, onConnect: noop, isConnecting: false, hasConnected: false };
const shipId = 'shp_01m4ahmavehywpqm4hnbgzs03w';
function connected(name: string): ShownConnection {
  return { state: 'connected', ship: { shipId, name }, lastShipId: shipId, scopes: { kind: 'read', missingScopes: [] } };
}
type State = 'before' | 'unavailable' | 'loading' | 'read-failed' | 'not-connected' | 'connecting' | 'connect-failed' | 'connected' | 'missing-scopes' | 'granting' | 'grant-failed' | 'granted' | 'scopes-failed';

function WatchBoard({ state }: { state: State }) {
  if (state === 'before' || state === 'unavailable') return null;
  if (state === 'loading') return <LoadingSkeleton variant="detail" rows={2} label="Loading the watch plugin" />;
  if (state === 'read-failed') return <InlineError title="Couldn’t read the watch plugin" description="The watch plugin did not answer" onRetry={noop} />;
  const isConnecting = state === 'connecting' || state === 'granting';
  const isConnected = ['connected', 'missing-scopes', 'granting', 'grant-failed', 'granted', 'scopes-failed'].includes(state);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3" data-testid="watch-mockup">
      <h2 className="text-body font-semibold">Watch plugin</h2>
      {isConnected ? <>
        <p className="text-body">Connected as <span className="font-mono">watch-plugin</span>{' '}<span className="font-mono text-muted-foreground">({shipId})</span></p>
        {state === 'scopes-failed' ? <FailedScopesRead plugin="the watch plugin" shipName="watch-plugin" reason="The fleet did not answer" onRetry={retry} /> :
          <MissingScopesPart plugin="the watch plugin" shipName="watch-plugin" missingScopes={['missing-scopes', 'granting', 'grant-failed'].includes(state) ? ['fleet:alert'] : []} isGranting={isConnecting} hasGranted={state === 'granted'} {...(state === 'grant-failed' ? { grantError: 'The fleet did not answer' } : {})} onGrant={noop} testId="watch-mockup" />}
      </> : <>
        <p className="text-body">Not connected. Connecting commissions the ship watch-plugin, with fleet read and alert, or gives it a new starting prompt, and hands its secret to the watch plugin. No one sees the secret.</p>
        <div><Button variant="primary" icon={<Link2 aria-hidden />} isLoading={isConnecting} onClick={noop}>Connect watch plugin</Button></div>
        {state === 'connect-failed' && <InlineError title="Couldn’t connect the watch plugin" description="A ship named watch-plugin of another type exists: rename or retire it, then connect again" />}
      </>}
    </section>
  );
}
function SettingsBoard({ state }: { state: State }) {
  return <div className="-m-6">
    <ConsoleFrame nav={{ active: 'settings', hasSettings: true, hasSquadrons: true, hasTrierarchs: true, hasNetwork: true }} account={AVATAR_MENU} fleetName="Acme">
      <ListPage title="Settings" description="How this installation runs. Only argo, the operator, sees this page." live="live" switcher={SWITCHER} account={AVATAR_MENU} onSearch={noop} onCompose={noop}>
        <SquadronsConnection {...actions} settings={connected('squadrons')} />
        <TrierarchPluginConnection {...actions} settings={connected('trierarch-plugin')} />
        <GatewayConnection {...actions} settings={connected('gateway')} />
        <WatchBoard state={state} />
        <TemplateRepositories repositories={[]} state="ready" onRetry={noop} isAdding={false} onAdd={noop} isRemoving={false} onRemove={noop} onRemoveClosed={noop} isRefreshing={false} onRefresh={noop} now={0} />
      </ListPage>
    </ConsoleFrame>
  </div>;
}
const meta = { title: 'Design/WatchConnection', component: SettingsBoard, args: { state: 'before' } } satisfies Meta<typeof SettingsBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Before: Story = {};
export const Unavailable: Story = { args: { state: 'unavailable' } };
export const Loading: Story = { args: { state: 'loading' } };
export const ReadFailed: Story = { args: { state: 'read-failed' } };
export const NotConnected: Story = { args: { state: 'not-connected' } };
export const Connecting: Story = { args: { state: 'connecting' } };
export const ConnectFailed: Story = { args: { state: 'connect-failed' } };
export const Connected: Story = { args: { state: 'connected' } };
export const MissingScopes: Story = { args: { state: 'missing-scopes' } };
export const Granting: Story = { args: { state: 'granting' } };
export const GrantFailed: Story = { args: { state: 'grant-failed' } };
export const Granted: Story = { args: { state: 'granted' } };
export const ScopesFailed: Story = { args: { state: 'scopes-failed' } };
