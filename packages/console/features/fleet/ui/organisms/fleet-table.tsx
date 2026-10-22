'use client';

import type { CrewStatus, LabelValueId, ListedShip, ShipId } from '@aeolus-fleet/common';
import { Eye, Flag, Plug, Search, Ship, SlidersHorizontal, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { useConsoleConstants } from '../../../../lib/console-constants';
import { Button, Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@aeolus-fleet/common/header';
import {
  activeFilterCount,
  activeFilterLabels,
  DEFAULT_FLEET_VIEW,
  filterFleet,
  fleetSquadrons,
  fleetTypes,
  retiredCount,
  STATUS_WORDS,
  type FleetFilters,
  type FleetView,
  type StatusFilter,
} from '../../services/fleet-filter';
import { AGENT_KIND_WORDS, isAgentKind } from '../../services/agent-kind';
import { nextSort, type FleetSort, type SortColumn } from '../../services/fleet-sort';
import { chipsOf, filterGroupsOf, pickedChips, type LabelContext } from '../../../../lib/labels';
import type { ShipInSquadron } from '../../../../lib/squadrons-view';
import { crewRequestKeyWord, crewRequestKeysOf, type CrewRequestKey } from '../../../../lib/needs-crew';
import { Badge } from '../../../../components/atoms/badge';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import { Switch } from '../../../../components/atoms/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSortHead } from '../../../../components/atoms/table';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LabelChip } from '../../../../components/molecules/label-chip';
import { LabelChips } from '../molecules/label-chips';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import { LastSeen } from '../molecules/last-seen';
import { LocationTag } from '../../../../components/molecules/location-tag';
import { ModelHint } from '../molecules/model-hint';
import { ReportLine } from '../../../../components/molecules/report-line';
import { SquadronTag } from '../../../../components/molecules/squadron-tag';
import { ShipName } from '../../../../components/molecules/ship-name';
import { StatusBadge } from '../../../../components/molecules/status-badge';
import { FilterSelect } from '../molecules/filter-select';
import { FilterToggles } from '../molecules/filter-toggles';
import { LabelFilterButton, PhoneLabelFilter, PickedLabels } from './label-filter';

/** Where row actions render: the desktop row menu, the phone row's actions sheet, or the one next step in the Report cell. */
export type RowActionsLayout = 'table' | 'phone' | 'next';

export interface FleetTableProps {
  /** Every ship of the fleet, argo and retired ships included; the table filters and orders them. */
  ships: readonly ListedShip[];
  /** Search and filters, kept by the page in the URL. */
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Ready shows the ships, or the empty state when argo is the only ship. */
  state: 'ready' | 'loading' | 'error';
  /** The error state's technical reason and retry. */
  error?: { detail?: string; onRetry: () => void };
  /** Ships that just appeared: their rows get --highlight and fade. */
  highlightedShipIds?: ReadonlySet<ShipId>;
  /** The time relative times are measured from. */
  now: Date;
  renderRowActions?: (ship: ListedShip, layout: RowActionsLayout) => ReactNode;
  /** The empty state's one action: Commission your first ship. */
  emptyAction?: ReactNode;
  /** With squadrons on, each flagship's and member's squadron, by ship id. */
  squadronsOf?: ReadonlyMap<string, ShipInSquadron>;
  /** The fleet's labels, once read (#102): chips on rows and the label filter. */
  labels?: LabelContext;
  /** The ships the console's plugins run as: squadrons' and the trierarch plugin's, each with a plugin chip (#368). */
  pluginShipIds?: ReadonlySet<string>;
}

/** The labels cell's character budget before the rest fold into a link to the ship page. */
const ROW_LABELS_WIDTH = 22;

/** The view with one more label value picked, one taken out, or none. */
function withLabels(view: FleetView, labelValueIds: readonly LabelValueId[]): FleetView {
  return { ...view, filters: { ...view.filters, labelValueIds } };
}

function isStatusFilter(value: string): value is StatusFilter {
  return Object.hasOwn(STATUS_WORDS, value);
}

/** The crew request filter's choices, in the order of a request's life. */
function crewRequestItemsOf(crewStatuses: readonly CrewStatus[]): Record<string, string> {
  return Object.fromEntries(crewRequestKeysOf(crewStatuses).map((key) => [key, crewRequestKeyWord(key)]));
}

function isCrewRequestFilter(value: string, items: Record<string, string>): value is CrewRequestKey {
  return Object.hasOwn(items, value);
}

/** Values that are their own words, such as ship types and squadron ids. */
function wordsOf(values: readonly string[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [value, value]));
}

/** What the no-results action clears: the search, the filters, or both. */
function clearLabel(query: string, filters: FleetFilters): string {
  const isFiltered = activeFilterCount(filters) > 0;
  if (query === '') {
    return 'Clear filters';
  }
  return isFiltered ? 'Clear search and filters' : 'Clear search';
}

/** Whether only argo sails: nothing but the operator, retired ships aside. */
function isOnlyArgo(ships: readonly ListedShip[]): boolean {
  return ships.every((ship) => ship.kind === 'operator' || ship.status === 'retired');
}

/**
 * The chip beside a ship's name: argo's operator kind chip, the viewer ship's
 * viewer kind chip; with squadrons on, a flagship's flagship kind chip and a
 * member's SquadronTag. Other ships carry none: their type stays a filter.
 */
function NameChip({ ship, squadron, isPluginShip }: { ship: ListedShip; squadron: ShipInSquadron | undefined; isPluginShip: boolean }) {
  if (ship.kind === 'operator') {
    return (
      <Badge variant="kind">
        <UserRound aria-hidden />
        operator
      </Badge>
    );
  }
  if (ship.kind === 'viewer') {
    return (
      <Badge variant="kind" data-testid="fleet-viewer">
        <Eye aria-hidden />
        viewer
      </Badge>
    );
  }
  if (isPluginShip) {
    return (
      <Badge variant="kind" data-testid="fleet-plugin">
        <Plug aria-hidden />
        plugin
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
  return null;
}

/** Only the current session's harness, location and stated model belong in Runs on. */
function RunsOn({ ship, now }: { ship: ListedShip; now: Date }) {
  if (ship.status !== 'crewed' || ship.kind === 'viewer') {
    return null;
  }
  return (
    <span data-testid="fleet-runs-on" className="flex min-w-0 items-center gap-3 max-sm:flex-wrap max-sm:gap-y-1">
      <LocationTag
        // argo's signed-in console names its device, never a model.
        kind={ship.kind === 'operator' && ship.location !== null ? 'DEVICE' : (ship.location?.kind ?? null)}
        description={ship.location?.description}
        harness={ship.kind === 'operator' ? 'console' : ship.harness}
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
function ReportCell({ ship, now, next }: { ship: ListedShip; now: Date; next: ReactNode }) {
  const isReporting = (ship.kind === 'agent' || ship.kind === 'plugin') && ship.status === 'crewed';
  return (
    <span className="flex min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch [&:has(button)>[data-testid=fleet-report]]:hidden">
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
  labels,
}: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange' | 'squadronsOf' | 'labels'> & { size: 'sm' | 'touch' }) {
  const crewRequestItems = crewRequestItemsOf(useConsoleConstants().crewStatuses);
  const { filters } = view;
  const change = (next: Partial<FleetFilters>) => {
    onViewChange({ ...view, filters: { ...filters, ...next } });
  };
  const isTouch = size === 'touch';
  return (
    <>
      <FilterSelect
        label="Status"
        items={STATUS_WORDS}
        picked={filters.status}
        onPickedChange={(picked) => {
          change({ status: picked.filter(isStatusFilter) });
        }}
        size={size}
        testId={isTouch ? undefined : 'fleet-filter-status'}
      />
      <FilterSelect
        label="Crew request"
        items={crewRequestItems}
        picked={filters.crewRequest}
        onPickedChange={(picked) => {
          change({ crewRequest: picked.filter((value) => isCrewRequestFilter(value, crewRequestItems)) });
        }}
        size={size}
        testId={isTouch ? undefined : 'fleet-filter-crew-request'}
      />
      <FilterSelect
        label="Kind"
        items={AGENT_KIND_WORDS}
        picked={filters.kind}
        onPickedChange={(picked) => {
          change({ kind: picked.filter(isAgentKind) });
        }}
        size={size}
        testId={isTouch ? undefined : 'fleet-filter-kind'}
      />
      <FilterSelect
        label="Type"
        items={wordsOf(fleetTypes(ships, filters.isRetiredShown))}
        picked={filters.type}
        onPickedChange={(picked) => {
          change({ type: picked });
        }}
        size={size}
        valueClassName="font-mono"
        testId={isTouch ? undefined : 'fleet-filter-type'}
      />
      {squadronsOf && (
        <FilterSelect
          label="Squadron"
          items={wordsOf(fleetSquadrons(squadronsOf))}
          picked={filters.squadron}
          onPickedChange={(picked) => {
            change({ squadron: picked });
          }}
          size={size}
          testId={isTouch ? undefined : 'fleet-filter-squadron'}
        />
      )}
      {labels === undefined || isTouch ? null : (
        <LabelFilterButton
          groups={filterGroupsOf(labels)}
          picked={pickedChips(filters.labelValueIds, labels)}
          onPick={(valueId) => {
            onViewChange(withLabels(view, [...filters.labelValueIds, valueId]));
          }}
        />
      )}
      {activeFilterLabels(filters).length > 0 && !isTouch ? (
        <Button
          variant="ghost"
          size="xs"
          data-testid="fleet-filters-clear"
          onClick={() => {
            onViewChange({ ...view, filters: DEFAULT_FLEET_VIEW.filters });
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </>
  );
}

/** Show retired on desktop: it sits with the ship count at the end of the filter bar's first row, however the filters wrap. */
function ShowRetiredSwitch({ ships, view, onViewChange }: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange'>) {
  const switchId = 'fleet-show-retired';
  return (
    <div className="inline-flex items-center gap-2">
      <Switch
        id={switchId}
        data-testid="fleet-show-retired"
        checked={view.filters.isRetiredShown}
        onCheckedChange={(isChecked) => {
          onViewChange({ ...view, filters: { ...view.filters, isRetiredShown: isChecked } });
        }}
      />
      <Label htmlFor={switchId} className="text-meta font-normal text-muted-foreground">
        Show retired ({retiredCount(ships)})
      </Label>
    </div>
  );
}

/**
 * The phone's filters in a bottom Sheet (canvas, MOverviewFilters): Status as
 * segments, Crew request, Kind, Type and Squadron as chips, each picking several values (#815), Show retired ships, and Show N ships
 * to close it. Reset puts every filter back; the search stays.
 */
function PhoneFilters({
  ships,
  view,
  onViewChange,
  shownCount,
  squadronsOf,
  labels,
}: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange' | 'squadronsOf' | 'labels'> & { shownCount: number }) {
  const crewRequestItems = crewRequestItemsOf(useConsoleConstants().crewStatuses);
  const { filters } = view;
  const change = (next: Partial<FleetFilters>) => {
    onViewChange({ ...view, filters: { ...filters, ...next } });
  };
  const active = activeFilterCount(filters);
  const retired = retiredCount(ships);
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            size="touch"
            isIconOnly
            aria-label={active > 0 ? `Filter ships, ${String(active)} active` : 'Filter ships'}
            data-testid="fleet-filters-open"
            icon={<SlidersHorizontal />}
            className="relative sm:hidden"
          >
            {active > 0 ? <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" /> : null}
          </Button>
        }
      />
      <SheetContent side="bottom">
        <SheetHeader className="flex-row items-center justify-between">
          <SheetTitle>Filter ships</SheetTitle>
          <Button
            variant="ghost"
            size="touch"
            data-testid="fleet-filters-reset"
            onClick={() => {
              onViewChange({ ...view, filters: DEFAULT_FLEET_VIEW.filters });
            }}
          >
            Reset
          </Button>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4 pb-4">
          <FilterToggles
            label="Status"
            layout="segments"
            items={STATUS_WORDS}
            picked={filters.status}
            onPickedChange={(picked) => {
              change({ status: picked.filter(isStatusFilter) });
            }}
          />
          <FilterToggles
            label="Crew request"
            items={crewRequestItems}
            picked={filters.crewRequest}
            onPickedChange={(picked) => {
              change({ crewRequest: picked.filter((value) => isCrewRequestFilter(value, crewRequestItems)) });
            }}
          />
          <FilterToggles
            label="Kind"
            items={AGENT_KIND_WORDS}
            picked={filters.kind}
            onPickedChange={(picked) => {
              change({ kind: picked.filter(isAgentKind) });
            }}
            testId="fleet-filter-kind-touch"
          />
          <FilterToggles
            label="Type"
            allLabel="All types"
            items={wordsOf(fleetTypes(ships, filters.isRetiredShown))}
            picked={filters.type}
            onPickedChange={(picked) => {
              change({ type: picked });
            }}
          />
          {squadronsOf && (
            <FilterToggles
              label="Squadron"
              items={wordsOf(fleetSquadrons(squadronsOf))}
              picked={filters.squadron}
              onPickedChange={(picked) => {
                change({ squadron: picked });
              }}
            />
          )}
          {labels === undefined ? null : (
            <PhoneLabelFilter
              groups={filterGroupsOf(labels)}
              picked={pickedChips(filters.labelValueIds, labels)}
              onPick={(valueId) => {
                onViewChange(withLabels(view, [...filters.labelValueIds, valueId]));
              }}
              onRemove={(valueId) => {
                onViewChange(withLabels(view, filters.labelValueIds.filter((each) => each !== valueId)));
              }}
            />
          )}
          <div className="flex items-center justify-between gap-2 py-1">
            <Label htmlFor="fleet-show-retired-touch" className="text-body-touch font-normal">
              Show retired ships <span className="text-muted-foreground">({retired})</span>
            </Label>
            <Switch
              id="fleet-show-retired-touch"
              checked={filters.isRetiredShown}
              onCheckedChange={(isChecked) => {
                change({ isRetiredShown: isChecked });
              }}
            />
          </div>
          <SheetClose render={<Button size="touch" data-testid="fleet-filters-apply" />}>
            {shownCount === 1 ? 'Show 1 ship' : `Show ${String(shownCount)} ships`}
          </SheetClose>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** The filters in force as chips under the phone's search, with Clear filters. */
function PhoneFilterChips({ view, onViewChange, labels }: Pick<FleetTableProps, 'view' | 'onViewChange' | 'labels'>) {
  const words = activeFilterLabels(view.filters);
  const picked = labels === undefined ? [] : pickedChips(view.filters.labelValueIds, labels);
  if (words.length === 0 && picked.length === 0) {
    return null;
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 sm:hidden" data-testid="fleet-filter-chips">
      {words.map((word) => (
        <Badge key={word} variant="outline" className="max-w-full truncate">
          {word}
        </Badge>
      ))}
      {picked.map((chip) => (
        <LabelChip
          key={chip.valueId}
          chip={chip}
          onRemove={() => {
            onViewChange(withLabels(view, view.filters.labelValueIds.filter((each) => each !== chip.valueId)));
          }}
        />
      ))}
      <Button
        variant="ghost"
        size="touch"
        onClick={() => {
          onViewChange({ ...view, filters: DEFAULT_FLEET_VIEW.filters });
        }}
      >
        Clear filters
      </Button>
    </div>
  );
}

function Toolbar({
  ships,
  view,
  onViewChange,
  shownCount,
  squadronsOf,
  labels,
}: Pick<FleetTableProps, 'ships' | 'view' | 'onViewChange' | 'squadronsOf' | 'labels'> & { shownCount: number }) {
  return (
    // On desktop one row (docs/design/png/FleetTable.png): the search and the filters wrap within their own group, Show retired and the count stay at the end of the first row (#1116).
    <div data-slot="fleet-toolbar" className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:items-start">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
        <div className="max-sm:hidden sm:contents">
          <FilterControls ships={ships} view={view} onViewChange={onViewChange} squadronsOf={squadronsOf} labels={labels} size="sm" />
        </div>
        <PhoneFilters ships={ships} view={view} onViewChange={onViewChange} shownCount={shownCount} squadronsOf={squadronsOf} labels={labels} />
      </div>
      <PhoneFilterChips view={view} onViewChange={onViewChange} labels={labels} />
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full sm:h-(--size-control-sm)">
        <div className="max-sm:hidden">
          <ShowRetiredSwitch ships={ships} view={view} onViewChange={onViewChange} />
        </div>
        <p aria-live="polite" className="text-meta text-muted-foreground tabular-nums">
          {shownCount} of {ships.length} ships
        </p>
      </div>
    </div>
  );
}

function ShipNameCell({ ship }: { ship: ListedShip }) {
  return (
    <ShipName name={ship.name} shipId={ship.id} isSuffixShown={ship.status === 'retired'} href={ship.kind === 'operator' ? '/inbox' : `/ships/${ship.id}`} className="[&_a]:max-sm:whitespace-normal [&_a]:max-sm:break-all [&_a]:max-sm:text-body-touch" />
  );
}

/** The desktop columns that sort, with their headers, in table order. */
const SORTED_HEADS: readonly { column: SortColumn; head: string }[] = [
  { column: 'ship', head: 'Ship' },
  { column: 'status', head: 'Status' },
  { column: 'report', head: 'Report' },
  { column: 'squadronAndLabels', head: 'Squadron and labels' },
  { column: 'runsOn', head: 'Runs on' },
  { column: 'seen', head: 'Seen' },
];

function DesktopTable({
  ships,
  highlightedShipIds,
  now,
  renderRowActions,
  squadronsOf,
  labels,
  pluginShipIds,
  sort,
  onSort,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'renderRowActions' | 'squadronsOf' | 'labels' | 'pluginShipIds'> & {
  ships: readonly ListedShip[];
  /** The column the rows are sorted by; with no `onSort`, the headers are plain. */
  sort?: FleetSort | null;
  onSort?: (column: SortColumn) => void;
}) {
  return (
    <div className="max-sm:hidden">
      <Table aria-label="Ships" className="min-w-320 table-fixed">
        <colgroup>
          <col className="w-56" />
          <col className="w-40" />
          <col className="w-64" />
          <col className="w-56" />
          <col className="w-80" />
          <col className="w-12" />
          <col className="w-12" />
        </colgroup>
        <TableHeader>
          <TableRow>
            {SORTED_HEADS.map(({ column, head }) =>
              onSort === undefined ? (
                <TableHead key={column}>{head}</TableHead>
              ) : (
                <TableSortHead
                  key={column}
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
          {ships.map((ship) => (
            <TableRow
              key={ship.id}
              data-testid={`fleet-row-${ship.name}`}
              data-new={highlightedShipIds?.has(ship.id) ? '' : undefined}
              className="h-12"
            >
              <TableCell>
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <ShipNameCell ship={ship} />
                  <NameChip ship={ship} squadron={squadronsOf?.get(ship.id)} isPluginShip={pluginShipIds?.has(ship.id) ?? false} />
                </span>
              </TableCell>
              <TableCell>
                <StatusBadge status={ship.status} />
              </TableCell>
              <TableCell>
                <ReportCell ship={ship} now={now} next={renderRowActions?.(ship, 'next')} />
              </TableCell>
              <TableCell>
                <ShipMetadata ship={ship} squadron={squadronsOf?.get(ship.id)} labels={labels} />
              </TableCell>
              <TableCell>
                <RunsOn ship={ship} now={now} />
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
  pluginShipIds,
}: Pick<FleetTableProps, 'highlightedShipIds' | 'now' | 'renderRowActions' | 'squadronsOf' | 'pluginShipIds'> & { ships: readonly ListedShip[] }) {
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
              <StatusBadge status={ship.status} />
              <NameChip ship={ship} squadron={squadronsOf?.get(ship.id)} isPluginShip={pluginShipIds?.has(ship.id) ?? false} />
            </div>
            <ShipMetadata ship={ship} squadron={squadronsOf?.get(ship.id)} />
            <ReportCell ship={ship} now={now} next={renderRowActions?.(ship, 'next')} />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <RunsOn ship={ship} now={now} />
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
 * FleetTable reserves the name and shows metadata once in a separate cell.
 * Desktop rows stay 48 px: ship, status, report, squadron and labels, runs on
 * (harness, location, muted model hint), seen and the existing row menu.
 * Phone separates the name, status, membership and session metadata; labels
 * remain on the ship page. A header sorts by its column, A to Z, Z to A,
 * then back to the default order (argo first, then by name); the phone list
 * follows the same order.
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

  const rows = { highlightedShipIds, now, renderRowActions, squadronsOf, pluginShipIds };
  if (isOnlyArgo(ships)) {
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

  const shown = filterFleet(ships, { ...view, squadronsOf, pluginShipIds });
  const query = view.query.trim();
  return (
    <div data-slot="fleet-table" data-state="ready" className="flex flex-col gap-3">
      <Toolbar ships={ships} view={view} onViewChange={onViewChange} shownCount={shown.length} squadronsOf={squadronsOf} labels={labels} />
      {labels === undefined ? null : (
        <PickedLabels
          groups={filterGroupsOf(labels)}
          picked={pickedChips(view.filters.labelValueIds, labels)}
          onPick={(valueId) => {
            onViewChange(withLabels(view, [...view.filters.labelValueIds, valueId]));
          }}
          onRemove={(valueId) => {
            onViewChange(withLabels(view, view.filters.labelValueIds.filter((each) => each !== valueId)));
          }}
          onClear={() => {
            onViewChange(withLabels(view, []));
          }}
        />
      )}
      {shown.length === 0 ? (
        <EmptyState
          variant="no-results"
          title={query === '' ? 'No ships match these filters.' : `No ships match “${query}”.`}
          action={
            <Button
              size="xs"
              data-testid="fleet-clear-filters"
              onClick={() => {
                onViewChange({ ...DEFAULT_FLEET_VIEW, sort: view.sort });
              }}
            >
              {clearLabel(query, view.filters)}
            </Button>
          }
        />
      ) : (
        <>
          <DesktopTable
            ships={shown}
            labels={labels}
            sort={view.sort}
            onSort={(column) => {
              onViewChange({ ...view, sort: nextSort(view.sort, column) });
            }}
            {...rows}
          />
          <PhoneList ships={shown} {...rows} />
        </>
      )}
    </div>
  );
}
