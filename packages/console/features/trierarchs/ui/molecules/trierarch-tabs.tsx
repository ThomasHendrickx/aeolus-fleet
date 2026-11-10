import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger } from '@aeolus-fleet/ui';

/**
 * Line sections keep their own console URLs; only a fleet manager sees them.
 * What they show sits 16 px below them at every width, as drawn: on phone the
 * page's gap is 14 px, so the tabs add the other 2.
 */
export function TrierarchTabs({ active }: { active: 'machines' | 'mcp' }) {
  return (
    <Tabs value={active} className="max-sm:mb-0.5">
      <TabsList variant="line" aria-label="Trierarchs sections">
        <TabsTrigger variant="line" value="machines" data-testid="trierarchs-machines-tab" render={<Link href="/trierarchs" />} nativeButton={false}>
          Machines
        </TabsTrigger>
        <TabsTrigger variant="line" value="mcp" data-testid="trierarchs-mcp-tab" render={<Link href="/trierarchs/mcp-servers" />} nativeButton={false}>
          MCP servers
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
