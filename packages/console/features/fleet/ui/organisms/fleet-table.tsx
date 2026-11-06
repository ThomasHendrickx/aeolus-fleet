'use client';

import type { FleetId, ListedShip, ShipId } from '@aeolus-fleet/common';
import { Eye, Flag, Plug, Ship } from 'lucide-react';
import type { ReactNode } from 'react';

import { nextSort, type FleetSort, type SortColumn } from '../../services/fleet-sort';
import { chipsOf, type LabelContext } from '../../../../lib/labels';
import type { ShipInSquadron } from '../../../../lib/squadrons-view';
import { counted } from '../../../../lib/sentence';
import { classNames, EmptyState, lastActivityWordsOf, ShipState } from '@aeolus-fleet/ui';
import { Badge } from '../../../../components/atoms/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSortHead } from '../../../../components/atoms/table';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadMore } from '../../../../components/molecules/load-more';
import { LabelChips } from '../molecules/label-chips';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { harnessWord } from '../../../../lib/harness';
import { locationKindWord } from '../../../../lib/location';
import { lastSeen } from '../../../../lib/relative-time';
import { ActivityLine } from '../../../../components/molecules/activity-line';
import { LocationTag } from '../../../../components/molecules/location-tag';
import { ModelHint } from '../molecules/model-hint';
import { ReportLine } from '../../../../components/molecules/report-line';
import { SquadronTag } from '../../../../components/molecules/squadron-tag';
import { ShipName } from '../../../../components/molecules/ship-name';

/** Where row actions render: the desktop row menu, the phone row's actions sheet, or the one next step in the Report cell. */
export type RowActionsLayout = 'table' | 'phone' | 'next';

export interface FleetTableProps {
  /** The ships of the pages loaded, as `fleet.list` selects and orders them for the view; the table shows them as they come. */
  ships: readonly ListedShip[];
  /** Whether argo is the fleet's only active ship: the empty state. */
  isOnlyArgo: boolean;
  /** The next page: Load more while more ships follow (decision 4 of the performance design). */
  more?: { hasMore: boolean; isLoading: boolean; isFailed: boolean; onLoad: () => void };
  /** The column the list is sorted by, kept by the page in the address. */
  sort: FleetSort | null;
  onSortChange: (sort: FleetSort | null) => void;
  /** Stands in for the rows when the bar's search and filters select no ship: the header stays, the message in the table. */
  noMatch?: ReactNode;
  /** A new result is coming: the rows shown are the previous one, dimmed. */
  isUpdating?: boolean;
  /** Ready shows the ships, or the empty state when argo is the only ship. */
  state: 'ready' | 'loading' | 'error';
  /** The error state's technical reason and retry. */
  error?: { detail?: string; onRetry: () => void };
  /** Ships that just appeared: their rows get --highlight and fade. */
  highlightedShipIds?: ReadonlySet<ShipId>;
  /** The time relative times are measured from. */
  now: Date;
  /** The viewer's fleet, for a report's message task; undefined until the session is known. */
  viewerFleetId: FleetId | undefined;
  renderRowActions?: (ship: ListedShip, layout: RowActionsLayout) => ReactNode;
  /** The empty state's one action: Commission your first ship. */
  emptyAction?: ReactNode;
  /** With squadrons on, each flagship's and member's squadron, by ship id. */
  squadronsOf?: ReadonlyMap<string, ShipInSquadron>;
  /** The fleet's labels, once read (#102): chips on rows. */
  labels?: LabelContext;
  /** The ships the console's plugins run as: squadrons' and the trierarch plugin's, each with a plugin chip (#368). */
  pluginShipIds?: ReadonlySet<string>;
}

/** The labels cell's character budget before the rest fold into a link to the ship page. */
const ROW_LABELS_WIDTH = 22;

/** A ship's type in a kind chip, as the overview's mockup puts it beside the name or the status. */
function TypeChip({ ship }: { ship: ListedShip }) {
  return (
    <Badge variant="kind" data-testid="fleet-type">
      {ship.type}
    </Badge>
  );
}

/**
 * The chip beside a ship's name (docs/design/fleet-overview, the list): the
 * type of every ship that is not an agent (argo, people, apps and plugins),
 * the viewer ship's viewer chip; an agent the console's plugins run as
 * carries the plugin chip, and with squadrons on, a flagship its flagship
 * chip. Other agents carry none: their type stays a filter.
 */
function NameChip({ ship, squadron, isPluginShip }: { ship: ListedShip; squadron: ShipInSquadron | undefined; isPluginShip: boolean }) {
  if (ship.kind === 'viewer') {
    return (
      <Badge variant="kind" data-testid="fleet-viewer">
        <Eye aria-hidden />
        viewer
      </Badge>
    );
  }
  if (ship.kind !== 'agent') {
    return <TypeChip ship={ship} />;
  }
  if (isPluginShip) {
    return (
      <Badge variant="kind" data-testid="fleet-plugin">
        <Plug aria-hidden />
        plugin
      </Badge>
    );
  }
  return <FlagshipChip squadron={squadron} />;
}

function FlagshipChip({ squadron }: { squadron: ShipInSquadron | undefined }) {
  if (squadron?.role !== null) {
    return null;
  }
  return (
    <Badge variant="kind" data-testid="fleet-flagship">
      <Flag aria-hidden />
      flagship
    </Badge>
  );
}

/** When the fleet last heard from a ship's session, in Harbour's words ("4 min", "yesterday"), the full words in its title; nothing without a session. */
function SeenTime({ seenAt, now, testId }: { seenAt: string | null; now: Date; testId?: string }) {
  if (seenAt === null) {
    return null;
  }
  return (
    <time dateTime={seenAt} title={lastSeen(new Date(seenAt), now)} data-testid={testId} className="text-meta whitespace-nowrap text-muted-foreground">
      {lastActivityWordsOf(seenAt, now)}
    </time>
  );
}

/** Where a crewed ship runs and when it was last seen, as one line of words on the phone: "Claude Code · Device · 4 min". */
function RunsOnLine({ ship, now }: { ship: ListedShip; now: Date }) {
  if (ship.status !== 'crewed' || ship.kind === 'viewer') {
    return null;
  }
  const harness = ship.kind === 'operator' ? 'console' : ship.harness;
  const location = ship.kind === 'operator' && ship.location !== null ? 'DEVICE' : ship.location?.kind;
  const words = [
    harness === null ? (ship.kind === 'agent' ? 'Harness unknown' : null) : harnessWord(harness),
    location === undefined ? null : locationKindWord(location),
    ship.lastSeenAt === null ? null : lastActivityWordsOf(ship.lastSeenAt, now),
  ].filter((word) => word !== null);
  return (
    <span data-testid="fleet-runs-on-line" className="text-meta text-muted-foreground">
      {words.join(' · ')}
    </span>
  );
}

/** Only the current session's harness, location and stated model belong in Runs on. */
function RunsOn({ ship, now }: { ship: ListedShip; now: Date }) {
  if (ship.status !== 'crewed' || ship.kind === 'viewer') {
    return null;
  }
  return (
    <span data-testid="fleet-runs-on" className="flex min-w-0 items-center gap-2 overflow-hidden max-sm:flex-wrap max-sm:gap-y-1">
      <LocationTag
        // argo's signed-in console names its device, never a model.
        kind={ship.kind === 'operator' && ship.location !== null ? 'DEVICE' : (ship.location?.kind ?? null)}
        description={ship.location?.description}
        harness={ship.kind === 'operator' ? 'console' : ship.harness}
        isHarnessUnknown={ship.kind === 'agent' && ship.harness === null}
        size="sm"
        className="shrink-0"
      />
      {ship.kind === 'agent' && ship.model !== null ? <ModelHint model={ship.model} now={now} /> : null}
    </span>
  );
}

/** Membership has its own space; the matching labels stay available on the ship page and in filters. */
function ShipMetadata({ ship, squadron, labels }: { ship: ListedShip; squadron: ShipInSquadron | undefined; labels?: LabelContext }) {
  const membership = squadron?.role === null ? undefined : squadron;
  const chips = labels === undefined ? [] : chipsOf(ship, labels).filter((chip) => !(
    membership !== undefined && (
      (chip.key === 'squadron' && chip.value === membership.squadronId) ||
      (chip.key === 'squadron-role' && chip.value === membership.role)
    )
  ));
  if (membership === undefined && chips.length === 0) {
    return null;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden">
      {membership === undefined ? null : (
        <span className="min-w-0 shrink" title={membership.role === null ? membership.squadronId : `${membership.squadronId} · ${membership.role}`}>
          <SquadronTag squadronId={membership.squadronId} size="sm" />
        </span>
      )}
      <LabelChips chips={chips} width={membership === undefined ? ROW_LABELS_WIDTH : 0} testId="fleet-labels" href={`/ships/${ship.id}`} />
    </span>
  );
}

/**
 * The Report cell: the row's one next step, when it has one (a starting
 * prompt for a ship awaiting crew, a new crew line for a silent member), and
 * a crewed ship's report with its time in the title. Only an agent or plugin
 * ship reports: argo and the viewer ship never do.
 */
function ReportCell({ ship, now, viewerFleetId, next }: { ship: ListedShip; now: Date; viewerFleetId: FleetId | undefined; next: ReactNode }) {
  const isReporting = (ship.kind === 'agent' || ship.kind === 'plugin') && ship.status === 'crewed';
  return (
    <span className="flex min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch [&:has(button)>[data-testid=fleet-report]]:hidden">
      {isReporting ? <ReportLine report={ship.report} now={now} variant="row" viewerFleetId={viewerFleetId} isTimeInTitle testId="fleet-report" /> : null}
      {next}
    </span>
  );
}

function ShipNameCell({ ship }: { ship: ListedShip }) {
  return (
    <ShipName name={ship.name} shipId={ship.id} isSuffixShown={ship.status === 'retired'} href={ship.kind === 'operator' ? '/inbox' : `/ships/${ship.id}`} className="[&_a]:max-sm:whitespace-normal [&_a]:max-sm:break-all [&_a]:max-sm:text-body-touch" />
  );
}

/** Each column's share of the width, as the overview's mockup draws it: every column in the page's width, never scrolling sideways. */
const COLUMN_WIDTHS = [
  { key: 'ship', width: 'w-[18%]' },
  { key: 'status', width: 'w-[13%]' },
  { key: 'report', width: 'w-[20%]' },
  { key: 'squadron-and-labels', width: 'w-[15%]' },
  { key: 'runs-on', width: 'w-[25%]' },
  { key: 'seen', width: 'w-[9%]' },
  // The row menu's button whatever the width.
  { key: 'actions', width: 'w-14' },
] as const;

/** The desktop columns with their headers, in table order, and the column each sorts by; Squadron and labels sorts by none. */
const HEADS: readonly { key: string; column?: SortColumn; head: string }[] = [
  { key: 'ship', column: 'ship', head: 'Ship' },
  { key: 'status', column: 'status', head: 'Status' },
  { key: 'report', column: 'report', head: 'Report' },
  { key: 'squadronAndLabels', head: 'Squadron and labels' },
  { key: 'runsOn', column: 'runsOn', head: 'Runs on' },
  { key: 'seen', column: 'seen', head: 'Seen' },
];

function DesktopTable({
  ships,
  highlightedShipIds,
  now,
  viewerFleetId,
  renderRowActions,
  squadronsOf,
  labels,
  pluginShipIds,
  sort,
  onSort,
  empty,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'viewerFleetId' | 'renderRowActions' | 'squadronsOf' | 'labels' | 'pluginShipIds'> & {
  ships: readonly ListedShip[];
  /** Stands in for the rows while there are none, under the header. */
  empty?: ReactNode;
  /** The column the rows are sorted by; with no `onSort`, the headers are plain. */
  sort?: FleetSort | null;
  onSort?: (column: SortColumn) => void;
}) {
  return (
    <div className="max-sm:hidden">
      <Table aria-label="Ships" className="w-full table-fixed">
        <colgroup>
          {COLUMN_WIDTHS.map(({ key, width }) => (
            <col key={key} className={width} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {HEADS.map(({ key, column, head }) =>
              onSort === undefined || column === undefined ? (
                <TableHead key={key}>{head}</TableHead>
              ) : (
                <TableSortHead
                  key={key}
                  data-testid={`fleet-sort-${column}`}
                  direction={sort?.column === column ? sort.direction : null}
                  onSort={() => {
                    onSort(column);
                  }}
                >
                  {head}
                </TableSortHead>
              ),
            )}
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ships.length === 0 && empty !== undefined ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={HEADS.length + 1} className="p-3 whitespace-normal">
                {empty}
              </TableCell>
            </TableRow>
          ) : null}
          {ships.map((ship) => (
            <TableRow
              key={ship.id}
              data-testid={`fleet-row-${ship.name}`}
              data-new={highlightedShipIds?.has(ship.id) ? '' : undefined}
            >
              <TableCell>
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <ShipNameCell ship={ship} />
                  <NameChip ship={ship} squadron={squadronsOf?.get(ship.id)} isPluginShip={pluginShipIds?.has(ship.id) ?? false} />
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <ShipState state={ship.status} />
                  <AlertBadge ship={ship} />
                </span>
              </TableCell>
              <TableCell>
                <ReportCell ship={ship} now={now} viewerFleetId={viewerFleetId} next={renderRowActions?.(ship, 'next')} />
              </TableCell>
              <TableCell>
                <ShipMetadata ship={ship} squadron={squadronsOf?.get(ship.id)} labels={labels} />
              </TableCell>
              <TableCell>
                <RunsOn ship={ship} now={now} />
              </TableCell>
              <TableCell>
                <span className="flex min-w-0 items-center gap-2">
                  <SeenTime seenAt={ship.lastSeenAt} now={now} testId="fleet-last-seen" />
                  <ActivityLine activity={ship.activity} now={now} variant="row" testId="fleet-activity" />
                </span>
              </TableCell>
              <TableCell className="w-10 text-right">{renderRowActions?.(ship, 'table')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The Alert badge after a ship's status while it has an open alert (docs/design/monitoring, 4.8); its title says how many. */
function AlertBadge({ ship }: { ship: ListedShip }) {
  if (ship.openAlertCount === 0) {
    return null;
  }
  return (
    <span title={counted(ship.openAlertCount, { one: 'open alert', many: 'open alerts' })} data-testid="fleet-alert">
      <ShipState state="alert" isBadge />
    </span>
  );
}

function PhoneList({
  ships,
  highlightedShipIds,
  now,
  viewerFleetId,
  renderRowActions,
  squadronsOf,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'viewerFleetId' | 'renderRowActions' | 'squadronsOf'> & { ships: readonly ListedShip[] }) {
  return (
    <ul aria-label="Ships" className="overflow-hidden rounded-lg border border-border bg-card sm:hidden">
      {ships.map((ship) => (
        <li
          key={ship.id}
          data-testid={`fleet-card-${ship.name}`}
          data-new={highlightedShipIds?.has(ship.id) ? '' : undefined}
          className="flex items-start gap-2 border-b border-border px-3.5 py-3 last:border-0 data-new:animate-highlight"
        >
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <div className="text-body-touch">
              <ShipNameCell ship={ship} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ShipState state={ship.status} />
              <AlertBadge ship={ship} />
              {ship.kind === 'viewer' ? <NameChip ship={ship} squadron={undefined} isPluginShip={false} /> : <TypeChip ship={ship} />}
              <FlagshipChip squadron={ship.kind === 'agent' ? squadronsOf?.get(ship.id) : undefined} />
            </div>
            <ShipMetadata ship={ship} squadron={squadronsOf?.get(ship.id)} />
            <ReportCell ship={ship} now={now} viewerFleetId={viewerFleetId} next={renderRowActions?.(ship, 'next')} />
            <RunsOnLine ship={ship} now={now} />
          </div>
          {renderRowActions?.(ship, 'phone')}
        </li>
      ))}
    </ul>
  );
}

/**
 * FleetTable reserves the name and shows metadata once in a separate cell.
 * Desktop rows stay 48 px: ship, status, report, squadron and labels, runs on
 * (harness, location, muted model hint), seen and the existing row menu.
 * Phone separates the name, status, membership and session metadata; labels
 * remain on the ship page. A header sorts by its column, A to Z, Z to A,
 * then back to the default order (argo first, then by name); the server
 * orders and selects the rows, and Load more reads the next page.
 */
export function FleetTable({
  ships,
  isOnlyArgo,
  more,
  sort,
  onSortChange,
  noMatch,
  isUpdating = false,
  state,
  error,
  highlightedShipIds,
  now,
  viewerFleetId,
  renderRowActions,
  emptyAction,
  squadronsOf,
  labels,
  pluginShipIds,
}: FleetTableProps) {
  if (state === 'loading') {
    return (
      <div data-slot="fleet-table" data-state="loading" className="flex flex-col gap-3">
        <LoadingSkeleton variant="table" rows={6} label="Loading the fleet" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={5} label="Loading the fleet" className="sm:hidden" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <InlineError
        variant="page"
        title="Couldn’t load the fleet"
        description="This page couldn’t reach the fleet server. Check that the server is running and reachable from this browser, then try again."
        detail={error?.detail}
        onRetry={error?.onRetry}
      />
    );
  }

  const rows = { highlightedShipIds, now, viewerFleetId, renderRowActions, squadronsOf, pluginShipIds };
  if (isOnlyArgo) {
    const argo = ships.filter((ship) => ship.kind === 'operator');
    return (
      <div data-slot="fleet-table" data-state="empty" className="flex flex-col gap-3">
        <DesktopTable ships={argo} labels={labels} {...rows} />
        <PhoneList ships={argo} {...rows} />
        <EmptyState
          icon={<Ship />}
          title="No ships besides argo yet"
          description="argo is your own ship: messages to the operator land in its inbox. Commission a ship to add an agent to the fleet."
          action={emptyAction}
        />
      </div>
    );
  }

  return (
    <div
      data-slot="fleet-table"
      data-state="ready"
      aria-busy={isUpdating}
      className={classNames('flex flex-col gap-3 transition-opacity duration-(--duration-fast) motion-reduce:transition-none', isUpdating ? 'opacity-55' : undefined)}
    >
      <DesktopTable
        ships={ships}
        labels={labels}
        sort={sort}
        onSort={(column) => {
          onSortChange(nextSort(sort, column));
        }}
        empty={noMatch}
        {...rows}
      />
      {ships.length === 0 ? <div className="sm:hidden">{noMatch}</div> : <PhoneList ships={ships} {...rows} />}
      {more?.hasMore === true ? <LoadMore what="more ships" isLoading={more.isLoading} isFailed={more.isFailed} onLoad={more.onLoad} area="fleet" /> : null}
    </div>
  );
}
