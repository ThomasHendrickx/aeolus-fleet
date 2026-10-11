import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { templateChoices } from '../../../lib/squadrons-view';
import { TemplateTable } from './template-table';
import { blueprints, templates } from '../../../lib/fixtures/squadrons.fixtures';

const meta = {
  title: 'Organisms/TemplateTable',
  component: TemplateTable,
  args: { templates: templateChoices({ templates }), blueprints, state: 'ready', onRetry: () => undefined },
} satisfies Meta<typeof TemplateTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { templates: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error', error: 'git fetch: could not resolve host' } };
