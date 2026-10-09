'use client';

import dynamic from 'next/dynamic';
import { useState, type ComponentType } from 'react';

/**
 * A dialog whose code loads when it is first opened, not with the page
 * (next/dynamic): until then it renders nothing; from then on it stays
 * mounted, so it closes with its animation. `isOpenOf` reads whether the
 * dialog is open from its props.
 */
export function lazyDialog<P extends object>(load: () => Promise<ComponentType<P>>, isOpenOf: (props: P) => boolean): ComponentType<P> {
  const Dialog = dynamic(load, { ssr: false });
  function LazyDialog(props: P) {
    const isOpen = isOpenOf(props);
    const [wasOpened, setWasOpened] = useState(isOpen);
    if (isOpen && !wasOpened) {
      setWasOpened(true);
    }
    return wasOpened || isOpen ? <Dialog {...props} /> : null;
  }
  return LazyDialog;
}
