import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { McpServersField } from './mcp-servers-field';

const meta = {
  title: 'Molecules/McpServersField',
  component: McpServersField,
  args: { shipName: 'triage-bot', picked: [], offered: ['company-graph', 'jira'], onAdd: fn(), onRemove: fn() },
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof McpServersField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** None picked: the session starts with no crew-time server. */
export const None: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('mcp-servers')).toHaveTextContent('None');
    await expect(canvas.getByTestId('mcp-servers-add')).toHaveTextContent('Add server');
  },
};

/** One server picked, as the approved mockups draw it. */
export const One: Story = { args: { picked: ['company-graph'] } };

/** Add server offers the servers the machines offer that are not picked yet, and picking one hands it over. */
export const AddsAnOfferedServer: Story = {
  args: { picked: ['company-graph'] },
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId('mcp-servers-add'));
    await expect(page.queryByRole('menuitem', { name: 'company-graph' })).toBeNull();
    await userEvent.click(await page.findByRole('menuitem', { name: 'jira' }));
    await expect(args.onAdd).toHaveBeenCalledWith('jira');
  },
};

/** × takes a server out. */
export const RemovesAServer: Story = {
  args: { picked: ['company-graph', 'jira'] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove company-graph' }));
    await expect(args.onRemove).toHaveBeenCalledWith('company-graph');
  },
};

/** No answering machine offers a server for the harness: Add server says so. Not drawn in the approved mockups. */
export const NoneOffered: Story = {
  args: { offered: [] },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId('mcp-servers-add'));
    await expect(await page.findByTestId('mcp-servers-none-offered')).toHaveTextContent('No machine offers an MCP server for this harness yet.');
  },
};

/** While the request is being sent: no ×, and Add server is off. */
export const Disabled: Story = {
  args: { picked: ['company-graph'], isDisabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Remove company-graph' })).toBeNull();
    await expect(canvas.getByTestId('mcp-servers-add')).toBeDisabled();
  },
};
