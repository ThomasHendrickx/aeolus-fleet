import { describe, expect, it } from 'vitest';

import {
  HANDED_OVERDUE_WAY,
  MAC_MINI,
  NOT_CREWED_WAY,
  NOTHING_WAITING_WAY,
  NOW,
  PULL_WAY,
  TRIERARCH_WAY,
  WATCHER_BUSY_WAY,
  minutesAgo,
} from '../../../lib/fixtures/ship-page.fixtures';
import { clockTime } from '../../../lib/relative-time';
import { shipWayView } from './ship-way';

const textsOf = (view: ReturnType<typeof shipWayView>) => view.lines.map((line) => line.text);

describe('shipWayView', () => {
  it('names the plugin watcher, the busy turn since when, and the oldest pending one argo was told of at 60 min (3.4)', () => {
    const view = shipWayView(WATCHER_BUSY_WAY, { now: NOW });

    expect(textsOf(view)).toEqual(['Plugin watcher', `Busy since ${clockTime(new Date(minutesAgo(70)))}`]);
    expect(view.oldest).toMatchObject({ status: 'pending', isOverdue: true, text: '1 h ago · argo told at 60 min' });
  });

  it('reads the oldest of several handed and never confirmed as handed, overdue at 10 min (3.8)', () => {
    const view = shipWayView(HANDED_OVERDUE_WAY, { now: NOW });

    expect(view.lines.at(-1)).toMatchObject({ icon: 'idle', tone: 'neutral' });
    expect(view.oldest).toMatchObject({ status: 'handedPushed', text: '12 min ago · not confirmed · argo told at 10 min · oldest of 3' });
  });

  it('names the trierarch on its computer, and says so when the trierarch plugin finds it silent (3.1)', () => {
    const silent = { shipId: MAC_MINI.id, isSilent: true, lastSeenAt: minutesAgo(9) };

    expect(textsOf(shipWayView(TRIERARCH_WAY, { now: NOW }))[0]).toBe('Trierarch on mac-mini');
    expect(shipWayView(TRIERARCH_WAY, { now: NOW, machines: [silent] }).lines[1]).toEqual({
      icon: 'silent',
      tone: 'attention',
      text: `Trierarch on mac-mini silent since ${clockTime(new Date(minutesAgo(9)))}`,
    });
  });

  it('reads a pull lease as served by no trierarch and no plugin, its oldest handed (pulled) and not acknowledged (4.2, 4.4)', () => {
    const view = shipWayView(PULL_WAY, { now: NOW });

    expect(textsOf(view)).toEqual(['Pull: nobody wakes it']);
    expect(view.oldest).toMatchObject({ status: 'handed', isOverdue: false, text: '10 min ago · not acknowledged' });
  });

  it('says nothing waits when nothing does', () => {
    const view = shipWayView(NOTHING_WAITING_WAY, { now: NOW });

    expect(textsOf(view).at(-1)).toBe('Nothing waiting');
    expect(view.oldest).toBeNull();
  });

  it('shows nothing while no session crews the ship', () => {
    expect(shipWayView(NOT_CREWED_WAY, { now: NOW })).toEqual({ lines: [], oldest: null });
  });

  it.each([
    ['gateway', 'Gateway'],
    ['personApp', "Person's app"],
    ['adapter', 'Adapter'],
  ] as const)('names the %s its lease stated as what wakes the ship (interop 5.1)', (kind, words) => {
    const view = shipWayView({ ...NOTHING_WAITING_WAY, lease: { by: { kind }, turn: null } }, { now: NOW });

    expect(textsOf(view)).toEqual([words]);
  });
});
