import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { blueprintChoices } from '../../lib/squadrons-view';
import { blueprints, templates } from './squadrons.fixtures';
import { FormSquadronDialog } from './form-squadron-dialog';

const meta = {
  title: 'Organisms/FormSquadronDialog',
  component: FormSquadronDialog,
  args: {
    blueprints: blueprintChoices({ blueprints }),
    templates,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onSubmit: () => undefined,
  },
} satisfies Meta<typeof FormSquadronDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickBlueprint: Story = {};
export const Forming: Story = { args: { isPending: true } };
export const FormingFailed: Story = { args: { error: 'The squadron manager did not answer. Nothing was commissioned.' } };
