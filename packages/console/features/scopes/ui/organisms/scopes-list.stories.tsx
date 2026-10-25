import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import type { NamespaceSection } from '../../services/scope-namespaces';
import { ScopesList } from './scopes-list';

const CORE: NamespaceSection[] = [
  {
    namespace: 'messages',
    whose: 'Core',
    isFleetOwn: false,
    scopes: [
      { scope: 'messages:send', description: 'Send, answer and ask other ships' },
      { scope: 'messages:receive', description: 'Receive and acknowledge its own deliveries' },
    ],
  },
  {
    namespace: 'fleet',
    whose: 'Core',
    isFleetOwn: false,
    scopes: [
      { scope: 'fleet:read', description: 'Read ships, timelines, messages, labels, events and fleet-wide views' },
      { scope: 'fleet:manage', description: 'Rename, release, recrew and retire the ships it manages' },
    ],
  },
  { namespace: 'gateway', whose: 'Declared by gateway', isFleetOwn: false, scopes: [{ scope: 'gateway:approve', description: 'Approve outside parties and switch their tools' }] },
];
const CRM: NamespaceSection = {
  namespace: 'crm',
  whose: "The fleet's own",
  isFleetOwn: true,
  scopes: [
    { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
    { scope: 'crm:write-leads', description: 'Change leads in the CRM' },
  ],
};

const meta = {
  title: 'Organisms/ScopesList',
  component: ScopesList,
  args: { sections: [...CORE, CRM], onRetry: fn(), onDefine: fn(), onDescribe: fn(), onRemove: fn() },
} satisfies Meta<typeof ScopesList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Core's and the plugins' read-only, the fleet's own with a menu each. */
export const List: Story = {};
/** The fleet has no scopes of its own yet: the line invites the first. */
export const Empty: Story = { args: { sections: CORE } };
/** A session without scopes:define reads them all, with no menu and no Define scope. */
export const ReadOnly: Story = { args: { onDefine: undefined, onDescribe: undefined, onRemove: undefined } };
export const Loading: Story = { args: { sections: undefined } };
export const LoadFailed: Story = { args: { error: 'fetch failed' } };
/** On phone: each scope over its description. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
/** A fleet scope's menu opens Change description and Remove for that scope. */
export const RowMenu: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(within(canvasElement).getByTestId('scopes-row-crm:write-leads')).getByTestId('scopes-row-menu'));
    await waitFor(async () => {
      await expect(await screen.findByTestId('scopes-remove')).toBeVisible();
    });
    await userEvent.click(screen.getByTestId('scopes-remove'));
    await expect(args.onRemove).toHaveBeenCalledWith({ scope: 'crm:write-leads', description: 'Change leads in the CRM' });
  },
};
