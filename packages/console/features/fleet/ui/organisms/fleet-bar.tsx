'use client';

import type { LabelValueId } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';
import { Search, SlidersHorizontal, X } from 'lucide-react';

import { Button, Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger, ShipState, type HarbourCounts, Input } from '@aeolus-fleet/ui';
import { LabelChip } from '../../../../components/molecules/label-chip';
import { filterGroupsOf, pickedChips, type LabelContext } from '../../../../lib/labels';
import { counted } from '../../../../lib/sentence';
import { activeFilterCount, DEFAULT_FLEET_VIEW, isFiltered, STATE_WORDS, type FleetFilters, type FleetView, type FleetViewMode } from '../../services/fleet-filter';
import { FilterChips } from '../molecules/filter-chips';
import { FilterSelect } from '../molecules/filter-select';
import { TypeFilter } from '../molecules/type-filter';
import { ViewSwitch } from '../molecules/view-switch';
import { LabelFilterButton, PickedLabels } from './label-filter';

function isHarbourState(value: string): value is HarbourState {
  return Object.hasOwn(STATE_WORDS, value);
}

/** A state as ShipState draws it (docs/design/state-colours): in its tone in the State menu, in the text colour on the phone's chips. */
function StateWord({ state, isToned = true }: { state: HarbourState; isToned?: boolean }) {
  return <ShipState state={state} className={isToned ? undefined : 'font-normal text-inherit'} />;
}

export interface FleetBarProps {
  /** The view, kept by the page in the address. */
  view: FleetView;
  onViewChange: (view: FleetView) => void;
  /** Harbour's numbers: how many ships each state holds, in the State menu. */
  counts: HarbourCounts | undefined;
  /** The fleet's types, each with how many ships carry it. */
  types: readonly { type: string; ships: number }[];
  /** The fleet's labels, once read (#102). */
  labels: LabelContext | undefined;
  /** How many ships the view shows; undefined until read. */
  shown: number | undefined;
  /** A pick is in: the count says Updating until the new result is. */
  isUpdating: boolean;
}

/** "19 ships" with nothing narrowing the view, "4 of 19 ships" with; Updating while a pick's result comes. */
function BarCount({ view, counts, shown, isUpdating }: Pick<FleetBarProps, 'view' | 'counts' | 'shown' | 'isUpdating'>) {
  if (isUpdating) {
    return (
      <span aria-live="polite" data-testid="fleet-count" className="inline-flex items-center gap-1.5 text-meta whitespace-nowrap text-muted-foreground">
        <i aria-hidden className="inline-block size-2.5 animate-spin rounded-full border-2 border-border border-t-muted-foreground motion-reduce:animate-none" />
        Updating
      </span>
    );
  }
  if (counts === undefined || shown === undefined) {
    return null;
  }
  const total = counted(counts.ships, { one: 'ship', many: 'ships' });
  return (
    <span aria-live="polite" data-testid="fleet-count" className="text-meta whitespace-nowrap text-muted-foreground tabular-nums">
      {isFiltered(view) ? `${String(shown)} of ${total}` : total}
    </span>
  );
}

function withFilters(view: FleetView, filters: Partial<FleetFilters>): FleetView {
  return { ...view, filters: { ...view.filters, ...filters } };
}

function withLabels(view: FleetView, labelValueIds: readonly LabelValueId[]): FleetView {
  return withFilters(view, { labelValueIds });
}

function SearchField({ view, onViewChange, isTouch }: Pick<FleetBarProps, 'view' | 'onViewChange'> & { isTouch: boolean }) {
  return (
    <Input
      type="search"
      aria-label="Search ships by name"
      placeholder={isTouch ? 'Search ships' : 'Search ships by name'}
      data-testid={isTouch ? 'fleet-search-touch' : 'fleet-search'}
      value={view.query}
      onChange={(event) => {
        onViewChange({ ...view, query: event.target.value });
      }}
      leadingIcon={<Search />}
      className={isTouch ? 'h-(--size-control-touch) text-input-touch' : 'h-(--size-control) text-meta'}
    />
  );
}

/** The phone's filters in force as chips under the search, each with ×, and Clear filters. */
function PhoneFilterChips({ view, onViewChange, labels }: Pick<FleetBarProps, 'view' | 'onViewChange' | 'labels'>) {
  const { filters } = view;
  const picked = labels === undefined ? [] : pickedChips(filters.labelValueIds, labels);
  if (filters.state.length === 0 && filters.type.length === 0 && picked.length === 0) {
    return null;
  }
  const chips = [
    { key: 'state', words: filters.state.length === 0 ? null : `State: ${filters.state.map((state) => STATE_WORDS[state]).join(', ')}`, clear: { state: [] } },
    { key: 'type', words: filters.type.length === 0 ? null : `Type: ${filters.type.join(', ')}`, clear: { type: [] } },
  ];
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="fleet-filter-chips">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map(({ key, words, clear }) =>
          words === null ? null : (
            <span key={key} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-secondary pr-1.5 pl-2.5 text-meta text-foreground">
              <span className="truncate">{words}</span>
              <button
                type="button"
                aria-label={`Clear ${key}`}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5"
                onClick={() => {
                  onViewChange(withFilters(view, clear));
                }}
              >
                <X aria-hidden />
              </button>
            </span>
          ),
        )}
        {picked.map((chip) => (
          <LabelChip
            key={chip.valueId}
            chip={chip}
            onRemove={() => {
              onViewChange(withLabels(view, filters.labelValueIds.filter((each) => each !== chip.valueId)));
            }}
          />
        ))}
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          onViewChange({ ...view, filters: DEFAULT_FLEET_VIEW.filters });
        }}
      >
        Clear filters
      </Button>
    </div>
  );
}

/**
 * The phone's filters in a bottom Sheet (docs/design/fleet-overview, "the
 * filter Sheet open"): State, Type and Label, each picking several; Show N
 * ships closes it, Clear filters puts every filter back. Behind a filter
 * button that shows how many are in force.
 */
function PhoneFilters({ view, onViewChange, types, labels, shown, isUpdating }: Pick<FleetBarProps, 'view' | 'onViewChange' | 'types' | 'labels' | 'shown' | 'isUpdating'>) {
  const { filters } = view;
  const active = activeFilterCount(filters);
  const labelItems = labels === undefined ? [] : filterGroupsOf(labels).flatMap((group) => group.keys.flatMap((key) => key.values.map((value) => ({ value: value.valueId, content: `${key.key}: ${value.value}` }))));
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button size="touch" isIconOnly aria-label={active > 0 ? `Filter ships, ${String(active)} in force` : 'Filter ships'} data-testid="fleet-filters-open" icon={<SlidersHorizontal />} className={active > 0 ? 'w-auto gap-2 px-3' : undefined}>
            {active > 0 ? (
              <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
                {active}
              </span>
            ) : null}
          </Button>
        }
      />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4 pb-4">
          <FilterChips
            label="State"
            items={Object.keys(STATE_WORDS)
              .filter(isHarbourState)
              .map((state) => ({ value: state, content: <StateWord state={state} isToned={false} /> }))}
            picked={filters.state}
            onPickedChange={(picked) => {
              onViewChange(withFilters(view, { state: picked.filter(isHarbourState) }));
            }}
            testId="fleet-filter-state-touch"
          />
          {types.length === 0 ? null : (
            <FilterChips
              label="Type"
              items={types.map(({ type }) => ({ value: type, content: type }))}
              picked={filters.type}
              onPickedChange={(picked) => {
                onViewChange(withFilters(view, { type: picked }));
              }}
              chipClassName="font-mono text-meta"
              testId="fleet-filter-type-touch"
            />
          )}
          {labelItems.length === 0 ? null : (
            <FilterChips
              label="Label"
              items={labelItems}
              picked={filters.labelValueIds}
              onPickedChange={(picked) => {
                onViewChange(withLabels(view, labelItems.filter((item) => picked.includes(item.value)).map((item) => item.value)));
              }}
              chipClassName="font-mono text-meta"
              testId="fleet-filter-labels-touch"
            />
          )}
          <SheetClose render={<Button variant="primary" size="touch" data-testid="fleet-filters-apply" />}>
            {isUpdating || shown === undefined ? 'Show ships' : `Show ${counted(shown, { one: 'ship', many: 'ships' })}`}
          </SheetClose>
          <Button
            size="touch"
            data-testid="fleet-filters-reset"
            onClick={() => {
              onViewChange({ ...view, filters: DEFAULT_FLEET_VIEW.filters });
            }}
          >
            Clear filters
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The overview's one bar (docs/design/fleet-overview, "One view: cards or
 * list"): search, State, Type and Labels, Clear filters while any is in
 * force, how many ships are shown, and the switch between cards and list;
 * the label values picked show under it as "Ships with a and b". The same
 * bar filters whichever view is shown. On the phone the filters move into a
 * Sheet behind a button that counts them, and each shows as a chip.
 */
export function FleetBar({ view, onViewChange, counts, types, labels, shown, isUpdating }: FleetBarProps) {
  const { filters } = view;
  const changeMode = (mode: FleetViewMode) => {
    onViewChange({ ...view, mode });
  };
  return (
    <div className="flex flex-col gap-2" data-testid="fleet-bar">
      <div className="flex items-start gap-3 max-sm:hidden">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="w-60">
            <SearchField view={view} onViewChange={onViewChange} isTouch={false} />
          </div>
          <FilterSelect
            label="State"
            items={STATE_WORDS}
            picked={filters.state}
            onPickedChange={(picked) => {
              onViewChange(withFilters(view, { state: picked.filter(isHarbourState) }));
            }}
            counts={counts && { total: counts.ships, of: counts }}
            renderItem={(value) => (isHarbourState(value) ? <StateWord state={value} /> : value)}
            testId="fleet-filter-state"
            className="h-(--size-control)"
          />
          <TypeFilter
            types={types}
            total={counts?.ships}
            picked={filters.type}
            onPickedChange={(picked) => {
              onViewChange(withFilters(view, { type: picked }));
            }}
          />
          {labels === undefined ? null : (
            <LabelFilterButton
              groups={filterGroupsOf(labels)}
              picked={pickedChips(filters.labelValueIds, labels)}
              onPickedChange={(picked) => {
                onViewChange(withLabels(view, picked));
              }}
            />
          )}
          {activeFilterCount(filters) > 0 || view.query.trim() !== '' ? (
            <Button
              variant="ghost"
              size="xs"
              icon={<X />}
              data-testid="fleet-filters-clear"
              className="text-muted-foreground"
              onClick={() => {
                onViewChange({ ...view, query: '', filters: DEFAULT_FLEET_VIEW.filters });
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="flex h-(--size-control) shrink-0 items-center gap-3">
          <BarCount view={view} counts={counts} shown={shown} isUpdating={isUpdating} />
          <ViewSwitch mode={view.mode} onModeChange={changeMode} />
        </div>
      </div>
      {labels === undefined ? null : (
        <PickedLabels
          groups={filterGroupsOf(labels)}
          picked={pickedChips(filters.labelValueIds, labels)}
          onPickedChange={(picked) => {
            onViewChange(withLabels(view, picked));
          }}
          onRemove={(valueId) => {
            onViewChange(withLabels(view, filters.labelValueIds.filter((each) => each !== valueId)));
          }}
          onClear={() => {
            onViewChange(withLabels(view, []));
          }}
        />
      )}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchField view={view} onViewChange={onViewChange} isTouch />
          </div>
          <PhoneFilters view={view} onViewChange={onViewChange} types={types} labels={labels} shown={shown} isUpdating={isUpdating} />
          <ViewSwitch mode={view.mode} onModeChange={changeMode} size="touch" />
        </div>
        <PhoneFilterChips view={view} onViewChange={onViewChange} labels={labels} />
      </div>
    </div>
  );
}
