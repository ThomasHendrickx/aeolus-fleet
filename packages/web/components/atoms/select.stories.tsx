import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const STATUS_ITEMS = { all: 'All', crewed: 'Crewed', awaitingCrew: 'Awaiting crew' };

function StatusSelect({ value, isDisabled = false }: { value: keyof typeof STATUS_ITEMS; isDisabled?: boolean }) {
  return (
    <Select items={STATUS_ITEMS} defaultValue={value} disabled={isDisabled}>
      <SelectTrigger aria-label="Status">
        <span className="text-muted-foreground">Status</span>
        <SelectValue className="font-medium" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(STATUS_ITEMS).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const meta = {
  title: 'Atoms/Select',
  component: StatusSelect,
} satisfies Meta<typeof StatusSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToolbarFilter: Story = { args: { value: 'all' } };
export const ValueSet: Story = { args: { value: 'crewed' } };
export const Disabled: Story = { args: { value: 'all', isDisabled: true } };

export const Touch: Story = {
  args: { value: 'awaitingCrew' },
  render: () => (
    <div className="max-w-80">
      <Select items={STATUS_ITEMS} defaultValue="awaitingCrew">
        <SelectTrigger size="touch" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STATUS_ITEMS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ),
};
