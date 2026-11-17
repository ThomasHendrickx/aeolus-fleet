// next/link in static documentation frames: a plain anchor.
export default function Link({ href, prefetch, replace, scroll, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props} />; }
export function useLinkStatus() { return { pending: false }; }
