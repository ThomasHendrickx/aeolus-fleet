/** The tabs of the ship page; Timeline unless the URL says another. */
export const SHIP_TABS = { timeline: 'timeline', messages: 'messages', schedules: 'schedules' } as const;
export type ShipTab = (typeof SHIP_TABS)[keyof typeof SHIP_TABS];

/** The tab a URL's `tab` value opens. */
export function shipTabOf(value: string | undefined): ShipTab {
  return value === SHIP_TABS.messages || value === SHIP_TABS.schedules ? value : SHIP_TABS.timeline;
}
