import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger } from '@aeolus-fleet/ui';

/**
 * Line sections keep their own console URLs and follow the session's scopes.
 * What they show sits 16 px below them at every width, as drawn: on phone the
 * page's gap is 14 px, so the tabs add the other 2.
 */
export function TrierarchTabs({ active, canSeeMcp = true, canSeeRuleSets = false }: {
  active: 'machines' | 'mcp' | 'rule-sets';
  canSeeMcp?: boolean;
  canSeeRuleSets?: boolean;
}) {
  return (
    <Tabs value={active} className="max-sm:mb-0.5">
      <TabsList variant="line" aria-label="Trierarchs sections">
        <TabsTrigger variant="line" value="machines" className="max-sm:px-1.5" data-testid="trierarchs-machines-tab" render={<Link href="/trierarchs" />} nativeButton={false}>
          Machines
        </TabsTrigger>
        {canSeeMcp ? <TabsTrigger variant="line" value="mcp" className="max-sm:px-1.5" data-testid="trierarchs-mcp-tab" render={<Link href="/trierarchs/mcp-servers" />} nativeButton={false}>
          MCP servers
        </TabsTrigger> : null}
        {canSeeRuleSets ? <TabsTrigger variant="line" value="rule-sets" className="max-sm:px-1.5" data-testid="trierarchs-rule-sets-tab" render={<Link href="/trierarchs/rule-sets" />} nativeButton={false}>
          Rule sets
        </TabsTrigger> : null}
      </TabsList>
    </Tabs>
  );
}
