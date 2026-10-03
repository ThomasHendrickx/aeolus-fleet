import { SQUADRON_STATES, type Squadron, type SquadronState } from './squadrons-api';

/**
 * The Squadrons list's search and filters (docs/design/png/SquadronTable.png):
 * search by squadron id or blueprint, state, blueprint, and Show disbanded.
 * Kept in the URL; defaults are left out.
 */
export interface SquadronView {
  query: string;
  state: Exclude<SquadronState, 'disbanded'> | 'all';
  /** A blueprint's name, or `all`. */
  blueprint: string;
  isDisbandedShown: boolean;
}

export const DEFAULT_SQUADRON_VIEW: SquadronView = { query: '', state: 'all', blueprint: 'all', isDisbandedShown: false };

const PARAMS = { query: 'q', state: 'state', blueprint: 'blueprint', isDisbandedShown: 'disbanded' } as const;
const SHOWN = '1';

/** The squadrons the list shows, in the order squadrons answers them: oldest first. */
export function filterSquadrons<S extends Pick<Squadron, 'id' | 'state' | 'blueprint'>>(squadrons: readonly S[], view: SquadronView): S[] {
  const needle = view.query.trim().toLowerCase();
  return squadrons.filter(
    (squadron) =>
      (view.isDisbandedShown || squadron.state !== 'disbanded') &&
      (view.state === 'all' || squadron.state === view.state) &&
      (view.blueprint === 'all' || squadron.blueprint.name === view.blueprint) &&
      (needle === '' || squadron.id.toLowerCase().includes(needle) || squadron.blueprint.name.toLowerCase().includes(needle)),
  );
}

/** The blueprints squadrons were formed from, for the blueprint filter, sorted. */
export function squadronBlueprints(squadrons: readonly Pick<Squadron, 'blueprint'>[]): string[] {
  return [...new Set(squadrons.map((squadron) => squadron.blueprint.name))].toSorted((first, second) => first.localeCompare(second));
}

/** How many squadrons are disbanded, for "Show disbanded (1)". */
export function disbandedCount(squadrons: readonly Pick<Squadron, 'state'>[]): number {
  return squadrons.filter((squadron) => squadron.state === 'disbanded').length;
}

function readState(value: string | null): SquadronView['state'] {
  const state = SQUADRON_STATES.find((each) => each === value);
  return state === undefined || state === 'disbanded' ? 'all' : state;
}

/** Reads the list's view from the URL; anything unknown falls back to the default. */
export function readSquadronView(params: URLSearchParams): SquadronView {
  return {
    query: params.get(PARAMS.query) ?? '',
    state: readState(params.get(PARAMS.state)),
    blueprint: params.get(PARAMS.blueprint) ?? 'all',
    isDisbandedShown: params.get(PARAMS.isDisbandedShown) === SHOWN,
  };
}

/** Writes the view as URL parameters, leaving out every default. */
export function squadronViewParams(view: SquadronView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.query !== '') {
    params.set(PARAMS.query, view.query);
  }
  if (view.state !== 'all') {
    params.set(PARAMS.state, view.state);
  }
  if (view.blueprint !== 'all') {
    params.set(PARAMS.blueprint, view.blueprint);
  }
  if (view.isDisbandedShown) {
    params.set(PARAMS.isDisbandedShown, SHOWN);
  }
  return params;
}
