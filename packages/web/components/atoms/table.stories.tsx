import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Ellipsis } from 'lucide-react';

import { Button } from './button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

const meta = {
  title: 'Atoms/Table',
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const SHIPS = [
  { name: 'planner', location: 'Device · MacBook', activity: '6 min ago' },
  { name: 'reviewer-01', location: 'Server · hetzner-1', activity: '2 min ago' },
  { name: 'auditor-01', location: 'No session', activity: 'Commissioned just now', isNew: true },
];

function Head() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Location</TableHead>
        <TableHead>Last activity</TableHead>
        <TableHead>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export const Rows: Story = {
  render: () => (
    <Table>
      <Head />
      <TableBody>
        {SHIPS.map((ship) => (
          <TableRow key={ship.name} data-new={ship.isNew ? '' : undefined}>
            <TableCell>
              <a href={`#${ship.name}`} className="font-medium outline-none">
                {ship.name}
              </a>
            </TableCell>
            <TableCell className="text-meta text-muted-foreground">{ship.location}</TableCell>
            <TableCell className="text-meta text-muted-foreground">{ship.activity}</TableCell>
            <TableCell className="w-12 text-right">
              <Button
                variant="ghost"
                size="xs"
                isIconOnly
                aria-label={`Actions for ${ship.name}`}
                icon={<Ellipsis />}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const NoMatches: Story = {
  render: () => (
    <Table>
      <Head />
      <TableBody>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="py-10 text-center">
            <div className="flex flex-col items-center gap-3">
              <span>No ships match “deploy”.</span>
              <Button size="sm">Clear search</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
