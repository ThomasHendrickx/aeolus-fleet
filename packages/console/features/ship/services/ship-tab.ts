/** The two tabs of the ship page; Timeline unless the URL says Messages. */
export const SHIP_TABS = { timeline: 'timeline', messages: 'messages' } as const;
export type ShipTab = (typeof SHIP_TABS)[keyof typeof SHIP_TABS];

/** The tab a URL's `tab` value opens. */
export function shipTabOf(value: string | undefined): ShipTab {
  return value === SHIP_TABS.messages ? SHIP_TABS.messages : SHIP_TABS.timeline;
}
