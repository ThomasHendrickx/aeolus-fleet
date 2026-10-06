import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { blueprintChoices } from '../../lib/squadrons-view';
import { BlueprintView } from './blueprint-view';
import { blueprints, forming, sailing, templates } from './squadrons.fixtures';

const [aeolus] = blueprintChoices({ blueprints });

const meta = {
  title: 'Organisms/BlueprintView',
  component: BlueprintView,
  args: {
    blueprint: aeolus ?? { key: 'none', repository: '', name: '', versions: [] },
    version: 4,
    onVersionChange: () => undefined,
    templates,
    squadrons: [forming, { ...sailing, id: 'aeolus-z8y7x6', blueprint: { ...forming.blueprint, version: 3 } }],
    onForm: () => undefined,
  },
} satisfies Meta<typeof BlueprintView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Latest: Story = {};
export const OlderVersion: Story = { args: { version: 3 } };
export const NoSquadronsYet: Story = { args: { squadrons: [] } };
