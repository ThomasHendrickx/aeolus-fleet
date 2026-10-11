import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';

function Ports({ value, isDisabled = false }: { value?: string; isDisabled?: boolean }) {
  return (
    <RadioGroup aria-label="Port" defaultValue={value} disabled={isDisabled}>
      {['3000', '4000'].map((port) => (
        <div key={port} className="inline-flex items-center gap-2">
          <RadioGroupItem id={`port-${port}`} value={port} />
          <Label htmlFor={`port-${port}`}>Port {port}</Label>
        </div>
      ))}
    </RadioGroup>
  );
}

const meta = {
  title: 'Atoms/RadioGroup',
  component: Ports,
} satisfies Meta<typeof Ports>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoneChosen: Story = { args: {} };
export const Chosen: Story = { args: { value: '4000' } };
export const Disabled: Story = { args: { value: '3000', isDisabled: true } };
