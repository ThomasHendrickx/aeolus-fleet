import { Plus, Shapes, WifiOff } from 'lucide-react';
import Link from 'next/link';

import { shortDateTime } from '../../lib/relative-time';
import type { Squadron } from '../../lib/squadrons-api';
import { stationCount } from '../../lib/squadrons-view';
import { Button } from '../atoms/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { EmptyState } from '../molecules/empty-state';
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
  onForm: () => void;
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
export function SquadronTable({ squadrons, state, hasBlueprints, error, onRetry, onForm }: SquadronTableProps) {
  if (state === 'loading') {
    return <LoadingSkeleton variant="table" label="Loading squadrons" />;
  }
  if (state === 'error') {
    return (
      <InlineError
        title="Couldn't load squadrons"
        description="The console couldn't reach the squadron manager. Your ships keep running; nothing is lost."
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
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={onForm} data-testid="squadrons-form-first">
            Form your first squadron
          </Button>
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
  return (
    <Table data-testid="squadrons-table">
      <TableHeader>
        <TableRow>
          <TableHead>Squadron</TableHead>
          <TableHead>Blueprint</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Members</TableHead>
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
              <span className="font-mono">{squadron.blueprint.name}</span> <span className="text-muted-foreground">v{squadron.blueprint.version}</span>
            </TableCell>
            <TableCell>
              <StatusBadge status={squadron.state} />
            </TableCell>
            <TableCell>{membersText(squadron)}</TableCell>
            <TableCell className="text-muted-foreground">{shortDateTime(new Date(squadron.formedAt))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
