import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from './tabs';

const meta = {
  title: 'Atoms/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Segmented: Story = {
  render: () => (
    <Tabs defaultValue="open">
      <TabsList aria-label="Messages">
        <TabsTrigger value="open">
          Open <TabsCount>3</TabsCount>
        </TabsTrigger>
        <TabsTrigger value="done">
          Done <TabsCount>3</TabsCount>
        </TabsTrigger>
        <TabsTrigger value="all">
          All <TabsCount>6</TabsCount>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="open">Open messages</TabsContent>
      <TabsContent value="done">Done messages</TabsContent>
      <TabsContent value="all">All messages</TabsContent>
    </Tabs>
  ),
};

export const Line: Story = {
  render: () => (
    <Tabs defaultValue="inbox" className="max-w-120">
      <TabsList variant="line" aria-label="Ship sections">
        <TabsTrigger variant="line" value="inbox">
          Inbox <TabsCount>3</TabsCount>
        </TabsTrigger>
        <TabsTrigger variant="line" value="sent">
          Sent <TabsCount>4</TabsCount>
        </TabsTrigger>
        <TabsTrigger variant="line" value="timeline">
          Timeline
        </TabsTrigger>
      </TabsList>
      <TabsContent value="inbox">Inbox</TabsContent>
      <TabsContent value="sent">Sent</TabsContent>
      <TabsContent value="timeline">Timeline</TabsContent>
    </Tabs>
  ),
};

export const PayloadView: Story = {
  render: () => (
    <Tabs defaultValue="formatted">
      <TabsList aria-label="Payload view">
        <TabsTrigger value="formatted">Formatted</TabsTrigger>
        <TabsTrigger value="raw">Raw</TabsTrigger>
      </TabsList>
    </Tabs>
  ),
};
