import { Plus, Shapes, WifiOff } from 'lucide-react';
import Link from 'next/link';

import { shortDateTime } from '../../lib/relative-time';
import { disbandedCount, filterSquadrons, squadronBlueprints, type SquadronView } from '../../lib/squadron-filter';
import type { Squadron } from '../../lib/squadrons-api';
import { blueprintPath, healthCounts, stationCount } from '../../lib/squadrons-view';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Switch } from '../atoms/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { EmptyState } from '../molecules/empty-state';
import { HealthSummary } from '../molecules/health-indicator';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { StatusBadge } from '../molecules/status-badge';

interface SquadronTableProps {
  squadrons: readonly Squadron[];
  state: 'loading' | 'error' | 'ready';
  /** Whether git holds a blueprint to form from: without one, the empty state says where blueprints come from. */
  hasBlueprints: boolean;
  /** Why loading failed, as squadrons said it. */
  error?: string;
  onRetry: () => void;
  /** Starts forming; left out for a session that may not manage the fleet (a viewer's), whose empty state then offers nothing. */
  onForm?: () => void;
  /** Search and filters, kept by the page in the URL. */
  view: SquadronView;
  onViewChange: (view: SquadronView) => void;
}

/** Members as the table says them: on station of all while Forming, the count otherwise. */
function membersText(squadron: Squadron): string {
  if (squadron.state === 'forming') {
    const { onStation, total } = stationCount(squadron);
    return `${String(onStation)} of ${String(total)} on station`;
  }
  return `${String(squadron.members.length)} ${squadron.members.length === 1 ? 'member' : 'members'}`;
}

/**
 * Every squadron of the fleet (docs/design/png/SquadronTable.png): its
 * blueprint version, state, members and when it was formed. The empty state
 * leads to forming the first squadron, or says where blueprints come from
 * when git has none.
 */
export function SquadronTable({ squadrons, state, hasBlueprints, error, onRetry, onForm, view, onViewChange }: SquadronTableProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="table" label="Loading squadrons" />;
  }
  if (state === 'error') {
    return (
      <InlineError
        title="Couldn’t load squadrons"
        description="The console couldn’t reach the squadron manager. Your ships keep running; nothing is lost."
        detail={error}
        onRetry={onRetry}
      />
    );
  }
  if (squadrons.length === 0) {
    return hasBlueprints ? (
      <EmptyState
        icon={<Shapes aria-hidden />}
        title="No squadrons yet"
        description="A squadron is a team of ships formed from a blueprint: a planner, implementers, a tester. You start each member's session by hand with its crew line."
        action={
          onForm && (
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={onForm} data-testid="squadrons-form-first">
              Form your first squadron
            </Button>
          )
        }
      />
    ) : (
      <EmptyState
        icon={<WifiOff aria-hidden />}
        title="No blueprints found"
        description="The squadron manager reads blueprints and templates from git. Add a blueprint there; it shows up here on its own."
      />
    );
  }
  const shown = filterSquadrons(squadrons, view);
  return (
    <div className="flex flex-col gap-3">
      <Toolbar squadrons={squadrons} view={view} onViewChange={onViewChange} shownCount={shown.length} />
      {shown.length === 0 ? (
        <EmptyState
          variant="no-results"
          title="No squadrons match"
          action={
            <Button
              onClick={() => {
                onViewChange({ query: '', state: 'all', blueprint: 'all', isDisbandedShown: view.isDisbandedShown });
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <SquadronRows squadrons={shown} />
      )}
    </div>
  );
}

const STATE_ITEMS: Record<SquadronView['state'], string> = { all: 'All', forming: 'Forming', sailing: 'Sailing', 'standing-down': 'Standing down' };

function isStateFilter(value: string): value is SquadronView['state'] {
  return Object.hasOwn(STATE_ITEMS, value);
}

/** Search by squadron or blueprint, State, Blueprint and Show disbanded, as the design draws them. */
function Toolbar({ squadrons, view, onViewChange, shownCount }: { squadrons: readonly Squadron[]; view: SquadronView; onViewChange: (view: SquadronView) => void; shownCount: number }) {
  const blueprintItems: Record<string, string> = { all: 'All', ...Object.fromEntries(squadronBlueprints(squadrons).map((name) => [name, name])) };
  return (
    <div data-slot="squadrons-toolbar" className="flex flex-wrap items-center gap-2">
      <div className="w-60 max-sm:min-w-0 max-sm:flex-1">
        <Input
          type="search"
          aria-label="Search squadrons"
          placeholder="Search squadrons"
          data-testid="squadrons-search"
          value={view.query}
          onChange={(event) => {
            onViewChange({ ...view, query: event.target.value });
          }}
        />
      </div>
      <Select
        items={STATE_ITEMS}
        value={view.state}
        onValueChange={(value) => {
          if (value !== null && isStateFilter(value)) {
            onViewChange({ ...view, state: value });
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="State" data-testid="squadrons-filter-state">
          <span className="flex gap-1.5">
            <span className="text-muted-foreground">State</span>
            <SelectValue className="font-medium" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STATE_ITEMS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={blueprintItems}
        value={view.blueprint}
        onValueChange={(value) => {
          if (value !== null) {
            onViewChange({ ...view, blueprint: value });
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="Blueprint" data-testid="squadrons-filter-blueprint">
          <span className="flex gap-1.5">
            <span className="text-muted-foreground">Blueprint</span>
            <SelectValue className="font-medium" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(blueprintItems).map(([value, label]) => (
            <SelectItem key={value} value={value} className={value === 'all' ? undefined : 'font-mono'}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="inline-flex items-center gap-2 sm:ml-auto">
        <Switch
          id="squadrons-show-disbanded"
          data-testid="squadrons-show-disbanded"
          checked={view.isDisbandedShown}
          onCheckedChange={(isChecked) => {
            onViewChange({ ...view, isDisbandedShown: isChecked });
          }}
        />
        <Label htmlFor="squadrons-show-disbanded" className="text-meta font-normal text-muted-foreground">
          Show disbanded ({disbandedCount(squadrons)})
        </Label>
        <span className="text-meta text-muted-foreground">
          {shownCount} of {squadrons.length} squadrons
        </span>
      </div>
    </div>
  );
}

function SquadronRows({ squadrons }: { squadrons: readonly Squadron[] }) {
  return (
    <Table data-testid="squadrons-table">
      <TableHeader>
        <TableRow>
          <TableHead>Squadron</TableHead>
          <TableHead>Blueprint</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Members</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Formed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {squadrons.map((squadron) => (
          <TableRow key={squadron.id} data-testid="squadrons-row">
            <TableCell>
              <Link href={`/squadrons/${squadron.id}`} className="font-medium hover:underline">
                {squadron.id}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={blueprintPath(squadron.blueprint)} className="hover:underline">
                <span className="font-mono">{squadron.blueprint.name}</span> <span className="text-muted-foreground">v{squadron.blueprint.version}</span>
              </Link>
            </TableCell>
            <TableCell>
              <StatusBadge status={squadron.state} />
            </TableCell>
            <TableCell>{membersText(squadron)}</TableCell>
            <TableCell>
              <HealthSummary counts={healthCounts(squadron.members)} />
            </TableCell>
            <TableCell className="text-muted-foreground">{shortDateTime(new Date(squadron.formedAt))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
