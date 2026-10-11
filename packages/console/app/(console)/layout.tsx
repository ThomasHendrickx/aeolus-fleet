import type { ReactNode } from 'react';

import { SignedInLayout } from './signed-in-layout';

/** Every signed-in page sits in the ConsoleFrame, which this route layout fills. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <SignedInLayout>{children}</SignedInLayout>;
}
