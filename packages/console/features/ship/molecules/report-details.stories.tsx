import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ReportDetails } from './report-details';

const meta = {
  title: 'Molecules/ReportDetails',
  component: ReportDetails,
  args: {
    details: {
      ships: { shp_01m48n6pw8xdyh82tg8qqe933n: { state: 'running' }, shp_01m3tbbbhxep52f5yd1kd4vjrc: { state: 'crashed', restarts: 5 } },
      kept: ['hemma-planner'],
    },
    bytes: 155,
    version: 7,
    testId: 'ship-report-details',
  },
} satisfies Meta<typeof ReportDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Folded: Story = {};
export const SmallObject: Story = { args: { details: { running: 4 }, bytes: 13, version: 1 } };
