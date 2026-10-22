'use client';

import { LoaderCircle } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/**
 * A navigation item's icon, inside its Link: while the page it opens is on
 * its way from the web app's server, a spinner in its place and a status for
 * assistive technology, so a click answers at once however slow the server
 * is (#1117).
 */
export function NavLinkIcon({ icon }: { icon: ReactNode }) {
  const { pending: isPending } = useLinkStatus();
  if (!isPending) {
    return icon;
  }
  return (
    <>
      <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
      <span role="status" className="sr-only">
        Opening
      </span>
    </>
  );
}
