import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { DefineLabelDialog } from './define-label-dialog';

const meta = {
  title: 'Organisms/DefineLabelDialog',
  component: DefineLabelDialog,
  args: { isOpen: true, onOpenChange: fn(), isPending: false, onSubmit: fn() },
} satisfies Meta<typeof DefineLabelDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A key, then values added one by one with Enter (canvas LbDefine). */
export const Empty: Story = {};
/** Being defined. */
export const Defining: Story = { args: { isPending: true } };
/** A key the fleet has (canvas LbDefineExists): the server names its owner; the input stays. */
export const KeyTaken: Story = { args: { error: 'The fleet has the label os already, owned by trierarch-plugin' } };
/** On phone (canvas LbMDefine). */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
