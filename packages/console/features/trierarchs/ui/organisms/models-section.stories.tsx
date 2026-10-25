import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { MACHINES } from '../../../../lib/fixtures/machines.fixtures';
import { modelRowsOf } from '../../services/model-rows';
import { ModelsSection, type ModelChange, type ModelsSectionProps } from './models-section';

const NO_RULE = modelRowsOf(MACHINES, []);
const RULE = modelRowsOf(MACHINES, ['claude-opus-5-5', 'gpt-6-sol']);
/** claude-opus-5-6 is enabled ahead of the harness update that reports it. */
const NOT_REPORTED = modelRowsOf(MACHINES, ['claude-opus-5-5', 'claude-opus-5-6']);

const meta = {
  title: 'Organisms/ModelsSection',
  component: ModelsSection,
  args: { rows: NO_RULE, canManage: true, onChange: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No model enabled: every model is allowed. */
export const NoRule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('trierarchs-models-rule')).toHaveTextContent('Every model is allowed. Enable a model to allow only the enabled ones.');
    await expect(canvas.getAllByTestId('trierarchs-model')).toHaveLength(4);
  },
};
/** Two models enabled: only they are placed. */
export const Rule: Story = {
  args: { rows: RULE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('trierarchs-models-rule')).toHaveTextContent('Only enabled models are placed. Crews already running keep their model.');
    await expect(canvas.getByRole('switch', { name: 'claude-opus-5-5: enabled' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'claude-sonnet-5: disabled' })).not.toBeChecked();
  },
};
/** An enabled id no trierarch reports. */
export const NotReported: Story = {
  args: { rows: NOT_REPORTED },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByTestId('trierarchs-model-reported').at(-1)).toHaveTextContent('no trierarch reports it');
  },
};
/** A viewer reads the models, its Switches disabled (Base UI marks them aria-disabled). */
export const Viewer: Story = {
  args: { rows: RULE, canManage: false },
  play: async ({ canvasElement }) => {
    for (const control of within(canvasElement).getAllByRole('switch')) {
      await expect(control).toHaveAttribute('aria-disabled', 'true');
    }
  },
};
export const Loading: Story = { args: { rows: undefined } };
export const ReadFailed: Story = { args: { rows: undefined, error: 'the trierarch plugin did not answer: try again in a moment' } };
export const Empty: Story = { args: { rows: [] } };
export const Saving: Story = { args: { rows: RULE, pending: { model: 'claude-sonnet-5', isEnabled: true } } };
/** The change was refused: the Switch is back, the reason by its row with Try again. */
export const Refused: Story = {
  args: { rows: RULE, failed: { model: 'claude-sonnet-5', isEnabled: true, message: 'the trierarch plugin did not answer: try again in a moment' } },
};

/** The section with a change that never answers, as a container holds it. */
function Pressing(props: ModelsSectionProps) {
  const [pending, setPending] = useState<ModelChange>();
  return <ModelsSection {...props} {...(pending === undefined ? {} : { pending })} onChange={setPending} />;
}

/** A press shows the change and Enabling… at once, every Switch waiting, before the plugin answers. */
export const PressShowsPending: Story = {
  args: { rows: RULE },
  render: (args) => <Pressing {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('switch', { name: 'claude-sonnet-5: disabled' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('Enabling…');
    await expect(canvas.getByRole('switch', { name: 'claude-sonnet-5: enabled' })).toHaveAttribute('aria-disabled', 'true');
  },
};
