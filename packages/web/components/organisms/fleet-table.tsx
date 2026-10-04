'use client';

import type { ListedShip, ShipId } from '@aeolus-fleet/common';
import { Flag, KeyRound, Search, Ship, SlidersHorizontal, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '../../lib/class-names';
import {
  DEFAULT_FLEET_VIEW,
  filterFleet,
  fleetSquadrons,
  fleetTypes,
  retiredCount,
  type FleetFilters,
  type FleetView,
} from '../../lib/fleet-filter';
import { fullDateTime, relativeTime } from '../../lib/relative-time';
import type { ShipInSquadron } from '../../lib/squadrons-view';
import { Badge } from '../atoms/badge';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../atoms/sheet';
import { Switch } from '../atoms/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { EmptyState } from '../molecules/empty-state';
import { InlineError } from '../molecules/inline-error';
import { LoadingSkeleton } from '../molecules/loading-skeleton';
import { LastSeen } from '../molecules/last-seen';
import { LocationTag } from '../molecules/location-tag';
import { ModelTag } from '../molecules/model-tag';
import { ReportLine } from '../molecules/report-line';
import { SquadronTag } from '../molecules/squadron-tag';
import { ShipName } from '../molecules/ship-name';
import { StatusBadge } from '../molecules/status-badge';

/** Where row actions render: the desktop row menu, the phone row's actions sheet, or the one next step in the Report cell. */
export type RowActionsLayout = 'table' | 'phone' | 'next';

interface FleetTableProps {
  /** Every ship of the fleet, argo and retired ships included; the table filters and orders them. */
  ships: readonly ListedShip[];
  /** Search and filters, kept by the page in the URL. */
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ready shows the ships, or the empty state when argo is the only ship. */
  state: 'ready' | 'loading' | 'error';
  /** The error state's technical reason and retry. */
  error?: { detail?: string; retryNote?: string; onRetry: () => void };
  /** Ships that just appeared: their rows get --highlight and fade. */
  highlightedShipIds?: ReadonlySet<ShipId>;
  /** The time relative times are measured from. */
  now: Date;
  renderRowActions?: (ship: ListedShip, layout: RowActionsLayout) => ReactNode;
  /** The empty state's one action: Commission your first ship. */
  emptyAction?: ReactNode;
  /** With squadrons on, each flagship's and member's squadron, by ship id. */
  squadronsOf?: ReadonlyMap<string, ShipInSquadron>;
}

const STATUS_ITEMS: Record<FleetFilters['status'], string> = {
  all: 'All',
  crewed: 'Crewed',
  awaitingCrew: 'Awaiting crew',
};

function isStatusFilter(value: string): value is FleetFilters['status'] {
  return Object.hasOwn(STATUS_ITEMS, value);
}

/** Whether only argo sails: nothing but the operator, retired ships aside. */
function isOnlyArgo(ships: readonly ListedShip[]): boolean {
  return ships.every((ship) => ship.kind === 'operator' || ship.status === 'retired');
}

/**
 * The chip beside a ship's name: argo's operator kind chip; with squadrons
 * on, a flagship's flagship kind chip and a member's SquadronTag. Other ships
 * carry none: their type stays a filter.
 */
function NameChip({ ship, squadron }: { ship: ListedShip; squadron: ShipInSquadron | undefined }) {
  if (ship.kind === 'operator') {
    return (
      <Badge variant="kind">
        <UserRound aria-hidden />
        operator
      </Badge>
    );
  }
  if (squadron?.role === null) {
    return (
      <Badge variant="kind" data-testid="fleet-flagship">
        <Flag aria-hidden />
        flagship
      </Badge>
    );
  }
  if (squadron) {
    return <SquadronTag squadronId={squadron.squadronId} role={squadron.role} size="sm" />;
  }
  return null;
}

/** An awaiting ship's starting prompt status, where a crewed ship shows where its session runs. */
function PromptStatus({ ship, now }: { ship: ListedShip; now: Date }) {
  const prompt = ship.startingPrompt;
  const frame = 'inline-flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0';
  if (prompt === null) {
    return (
      <span className={frame}>
        <KeyRound aria-hidden />
        No starting prompt issued
      </span>
    );
  }
  const issuedAt = new Date(prompt.issuedAt);
  return (
    <span className={frame}>
      <KeyRound aria-hidden />
      <span className="truncate">
        Prompt issued{' '}
        <time dateTime={prompt.issuedAt} title={fullDateTime(issuedAt)}>
          {relativeTime(issuedAt, now)}
        </time>
        {prompt.isClaimed ? ', claimed' : ', not claimed yet'}
      </span>
    </span>
  );
}

/** Runs on: the harness and location kind of a crewed ship's session (argo: its console), or an awaiting ship's prompt status. */
function RunsOn({ ship, now }: { ship: ListedShip; now: Date }) {
  if (ship.status === 'retired') {
    return null;
  }
  if (ship.status === 'awaitingCrew') {
    return <PromptStatus ship={ship} now={now} />;
  }
  return (
    <LocationTag
      // argo runs on "Console · Device" (docs/design/conventions.md); its location's words name the device signed in from.
      kind={ship.kind === 'operator' && ship.location !== null ? 'DEVICE' : (ship.location?.kind ?? null)}
      description={ship.location?.description}
      harness={ship.kind === 'operator' ? 'console' : ship.harness}
      size="sm"
    />
  );
}

/**
 * The Report cell: the row's one next step, when it has one (a starting
 * prompt for a ship awaiting crew, a new crew line for a silent member), and
 * a crewed ship's report with its time in the title. argo never reports.
 */
function ReportCell({ ship, now, next }: { ship: ListedShip; now: Date; next: ReactNode }) {
  const isReporting = ship.kind !== 'operator' && ship.status === 'crewed';
  return (
    <span className="flex min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
      {isReporting ? <ReportLine report={ship.report} now={now} variant="row" isTimeInTitle testId="fleet-report" /> : null}
      {next}
    </span>
  );
}

function FilterControls({
  ships,
  view,
  onViewChange,
  size,
  squadronsOf,
}: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange' | 'squadronsOf'> & { size: 'sm' | 'touch' }) {
  const { filters } = view;
  const types = fleetTypes(ships, filters.isRetiredShown);
  const typeItems: Record<string, string> = { all: 'All', ...Object.fromEntries(types.map((type) => [type, type])) };
  const retired = retiredCount(ships);
  const switchId = size === 'sm' ? 'fleet-show-retired' : 'fleet-show-retired-touch';
  const change = (next: Partial<FleetFilters>) => {
    onViewChange({ ...view, filters: { ...filters, ...next } });
  };
  const isTouch = size === 'touch';
  return (
    <>
      <Select
        items={STATUS_ITEMS}
        value={filters.status}
        onValueChange={(value) => {
          if (value !== null && isStatusFilter(value)) {
            change({ status: value });
          }
        }}
      >
        <SelectTrigger size={size} aria-label="Status" data-testid={isTouch ? undefined : 'fleet-filter-status'}>
          <span className="flex gap-1.5">
            <span className="text-muted-foreground">Status</span>
            <SelectValue className="font-medium" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(STATUS_ITEMS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={typeItems}
        value={filters.type}
        onValueChange={(value) => {
          if (value !== null) {
            change({ type: value });
          }
        }}
      >
        <SelectTrigger size={size} aria-label="Type" data-testid={isTouch ? undefined : 'fleet-filter-type'}>
          <span className="flex gap-1.5">
            <span className="text-muted-foreground">Type</span>
            <SelectValue className="font-medium" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(typeItems).map(([value, label]) => (
            <SelectItem key={value} value={value} className={value === 'all' ? undefined : 'font-mono'}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {squadronsOf && (
        <Select
          items={{ all: 'All', ...Object.fromEntries(fleetSquadrons(squadronsOf).map((squadron) => [squadron, squadron])) }}
          value={filters.squadron}
          onValueChange={(value) => {
            if (value !== null) {
              change({ squadron: value });
            }
          }}
        >
          <SelectTrigger size={size} aria-label="Squadron" data-testid={isTouch ? undefined : 'fleet-filter-squadron'}>
            <span className="flex gap-1.5">
              <span className="text-muted-foreground">Squadron</span>
              <SelectValue className="font-medium" />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {fleetSquadrons(squadronsOf).map((squadron) => (
              <SelectItem key={squadron} value={squadron}>
                {squadron}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className={classNames('inline-flex items-center gap-2', isTouch ? 'py-2' : 'sm:ml-auto')}>
        <Switch
          id={switchId}
          data-testid={isTouch ? undefined : 'fleet-show-retired'}
          checked={filters.isRetiredShown}
          onCheckedChange={(isChecked) => {
            change({ isRetiredShown: isChecked });
          }}
        />
        <Label
          htmlFor={switchId}
          className={classNames('font-normal text-muted-foreground', isTouch ? 'text-body-touch' : 'text-meta')}
        >
          Show retired ({retired})
        </Label>
      </div>
    </>
  );
}

function Toolbar({
  ships,
  view,
  onViewChange,
  shownCount,
  squadronsOf,
}: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange' | 'squadronsOf'> & { shownCount: number }) {
  return (
    <div data-slot="fleet-toolbar" className="flex flex-wrap items-center gap-2">
      <div className="w-60 max-sm:min-w-0 max-sm:flex-1">
        <Input
          type="search"
          aria-label="Search ships by name or type"
          placeholder="Search ships by name"
          data-testid="fleet-search"
          value={view.query}
          onChange={(event) => {
            onViewChange({ ...view, query: event.target.value });
          }}
          leadingIcon={<Search />}
          className="h-(--size-control-sm) text-meta max-sm:h-(--size-control-touch) max-sm:text-input-touch"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:hidden sm:flex-1">
        <FilterControls ships={ships} view={view} onViewChange={onViewChange} squadronsOf={squadronsOf} size="sm" />
      </div>
      <Sheet>
        <SheetTrigger
          render={
            <Button size="touch" isIconOnly aria-label="Filters" icon={<SlidersHorizontal />} className="sm:hidden" />
          }
        />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-3 pb-4 [&_[data-slot=select-trigger]]:w-full">
            <FilterControls ships={ships} view={view} onViewChange={onViewChange} squadronsOf={squadronsOf} size="touch" />
          </SheetBody>
        </SheetContent>
      </Sheet>
      <p aria-live="polite" className="text-meta text-muted-foreground tabular-nums max-sm:w-full">
        {shownCount} of {ships.length} ships
      </p>
    </div>
  );
}

function ShipNameCell({ ship }: { ship: ListedShip }) {
  return (
    <ShipName name={ship.name} shipId={ship.id} isSuffixShown={ship.status === 'retired'} href={`/ships/${ship.id}`} />
  );
}

function DesktopTable({
  ships,
  highlightedShipIds,
  now,
  renderRowActions,
  squadronsOf,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'renderRowActions' | 'squadronsOf'> & { ships: readonly ListedShip[] }) {
  return (
    <div className="max-sm:hidden">
      <Table aria-label="Ships">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Runs on</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Seen</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ships.map((ship) => (
            <TableRow
              key={ship.id}
              data-testid={`fleet-row-${ship.name}`}
              data-new={highlightedShipIds?.has(ship.id) ? '' : undefined}
              className="h-12"
            >
              <TableCell className="max-w-64">
                <span className="flex min-w-0 items-center gap-2">
                  <ShipNameCell ship={ship} />
                  <NameChip ship={ship} squadron={squadronsOf?.get(ship.id)} />
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={ship.status} />
              </TableCell>
              <TableCell className="max-w-72">
                <ReportCell ship={ship} now={now} next={renderRowActions?.(ship, 'next')} />
              </TableCell>
              <TableCell className="max-w-56">
                <RunsOn ship={ship} now={now} />
              </TableCell>
              <TableCell>
                {ship.kind === 'operator' ? null : <ModelTag model={ship.model} isCrewed={ship.status === 'crewed'} now={now} testId="fleet-model" />}
              </TableCell>
              <TableCell>
                <LastSeen seenAt={ship.lastSeenAt} now={now} testId="fleet-last-seen" />
              </TableCell>
              <TableCell className="w-10 text-right">{renderRowActions?.(ship, 'table')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PhoneList({
  ships,
  highlightedShipIds,
  now,
  renderRowActions,
  squadronsOf,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'renderRowActions' | 'squadronsOf'> & { ships: readonly ListedShip[] }) {
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
            <div className="flex items-center justify-between gap-3 text-body-touch">
              <span className="flex min-w-0 items-center gap-2">
                <ShipNameCell ship={ship} />
                <NameChip ship={ship} squadron={squadronsOf?.get(ship.id)} />
              </span>
              <StatusBadge status={ship.status} />
            </div>
            <ReportCell ship={ship} now={now} next={renderRowActions?.(ship, 'next')} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <RunsOn ship={ship} now={now} />
              {ship.kind === 'operator' ? null : <ModelTag model={ship.model} isCrewed={ship.status === 'crewed'} now={now} />}
              <LastSeen seenAt={ship.lastSeenAt} now={now} />
            </div>
          </div>
          {renderRowActions?.(ship, 'phone')}
        </li>
      ))}
    </ul>
  );
}

/**
 * The fleet overview list (docs/design/png/FleetTable.png): one calm 48 px
 * line per ship. Columns name (with the operator chip, flagship chip or
 * SquadronTag), status, report, runs on (harness and location kind; an
 * awaiting ship's prompt status), model and last seen (an icon). argo sorts
 * first and never reports; search and filters apply to it like any ship.
 * Every action lives in the row menu; the Report cell shows at most one next
 * step. On phone each ship becomes a row of up to three lines with its
 * actions in a bottom Sheet, and the filters move into a bottom Sheet too. Rows update in place and never reorder under the
 * pointer; ships that just appeared are highlighted.
 */
export function FleetTable({
  ships,
  view,
  onViewChange,
  state,
  error,
  highlightedShipIds,
  now,
  renderRowActions,
  emptyAction,
  squadronsOf,
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
        description="This page couldn’t reach the fleet server. Nothing is lost; try again."
        detail={error?.detail}
        retryNote={error?.retryNote}
        onRetry={error?.onRetry}
      />
    );
  }

  const rows = { highlightedShipIds, now, renderRowActions, squadronsOf };
  if (isOnlyArgo(ships)) {
    const argo = ships.filter((ship) => ship.kind === 'operator');
    return (
      <div data-slot="fleet-table" data-state="empty" className="flex flex-col gap-3">
        <DesktopTable ships={argo} {...rows} />
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

  const shown = filterFleet(ships, { ...view, squadronsOf });
  const query = view.query.trim();
  return (
    <div data-slot="fleet-table" data-state="ready" className="flex flex-col gap-3">
      <Toolbar ships={ships} view={view} onViewChange={onViewChange} shownCount={shown.length} squadronsOf={squadronsOf} />
      {shown.length === 0 ? (
        <EmptyState
          variant="no-results"
          title={query === '' ? 'No ships match these filters.' : `No ships match “${query}”.`}
          action={
            <Button
              size="xs"
              data-testid="fleet-clear-filters"
              onClick={() => {
                onViewChange(DEFAULT_FLEET_VIEW);
              }}
            >
              {query === '' ? 'Clear filters' : 'Clear search'}
            </Button>
          }
        />
      ) : (
        <>
          <DesktopTable ships={shown} {...rows} />
          <PhoneList ships={shown} {...rows} />
        </>
      )}
    </div>
  );
}
