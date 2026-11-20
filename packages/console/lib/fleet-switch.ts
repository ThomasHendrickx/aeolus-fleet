'use client';

import type { SwitcherFleet } from '@aeolus-fleet/common/rules';
import type { FleetSwitch } from '@aeolus-fleet/ui';
import { useState } from 'react';

/** The search parameter the page arrives with after another fleet opened: that fleet's id. */
export const ARRIVED_PARAMETER = 'arrived';

/** What the web app's server answers when the panel opens a fleet in place (lib/account-sign-in.ts, openFleet). */
type OpenFleetAnswer = { outcome: 'opened' } | { outcome: 'failed' } | { outcome: 'sign-in'; location: string };

function isOpenFleetAnswer(value: unknown): value is OpenFleetAnswer {
  return typeof value === 'object' && value !== null && 'outcome' in value && (value.outcome === 'opened' || value.outcome === 'failed' || (value.outcome === 'sign-in' && 'location' in value && typeof value.location === 'string'));
}

/** Asks the web app's server to open the fleet in place; failed when it does not answer. */
async function openInPlace(fleetId: string): Promise<OpenFleetAnswer> {
  try {
    const response = await fetch(`/sign-in/fleet?${new URLSearchParams({ fleet: fleetId }).toString()}`, { method: 'POST', cache: 'no-store' });
    const answer: unknown = await response.json();
    return response.ok && isOpenFleetAnswer(answer) ? answer : { outcome: 'failed' };
  } catch {
    return { outcome: 'failed' };
  }
}

/**
 * Opening another fleet from the Apps and fleets panel
 * (docs/design/app-navigation, section 4; header design H9). A fleet this
 * console runs for opens in place: the row says it is opening at once, the
 * web app's server enters the fleet with the same sign-in, and the console
 * loads its fleet overview there, which says it arrived. A failure keeps the
 * console where it was and the panel offers Try again, busy while it works.
 * A fleet elsewhere (another console, or Account) opens at its address. A
 * shared sign-in that ended signs in again, back to that fleet.
 */
export function useFleetSwitch(): { fleetSwitch: FleetSwitch | undefined; onOpenFleet: (fleet: SwitcherFleet) => void } {
  const [fleetSwitch, setFleetSwitch] = useState<FleetSwitch | undefined>(undefined);
  const onOpenFleet = (fleet: SwitcherFleet) => {
    const isAgain = fleetSwitch?.fleetId === fleet.id && fleetSwitch.state === 'failed';
    setFleetSwitch({ fleetId: fleet.id, state: isAgain ? 'retrying' : 'opening' });
    if (new URL(fleet.url, window.location.href).origin !== window.location.origin) {
      window.location.assign(fleet.url);
      return;
    }
    void openInPlace(fleet.id).then((answer) => {
      switch (answer.outcome) {
        case 'opened':
          // A fresh page in the other fleet: nothing read for the fleet left stays.
          window.location.assign(`/?${new URLSearchParams({ [ARRIVED_PARAMETER]: fleet.id }).toString()}`);
          return;
        case 'sign-in':
          window.location.assign(answer.location);
          return;
        case 'failed':
          setFleetSwitch({ fleetId: fleet.id, state: 'failed' });
          return;
      }
    });
  };
  return { fleetSwitch, onOpenFleet };
}
