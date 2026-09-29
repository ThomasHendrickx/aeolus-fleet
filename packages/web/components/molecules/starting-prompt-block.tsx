'use client';

import { useId, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_MESSAGES: Record<CopyState, string> = {
  idle: '',
  copied: 'Copied.',
  failed: 'Could not copy: select the text and copy it by hand.',
};

/**
 * A starting prompt, shown once: the operator copies it into a new session.
 * It holds the ship's secret, which the fleet never shows again, so nothing
 * here keeps it beyond this view.
 */
export function StartingPromptBlock({
  shipName,
  prompt,
  onDone,
}: {
  shipName: string;
  prompt: string;
  onDone: () => void;
}) {
  const headingId = useId();
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <section aria-labelledby={headingId} data-testid="starting-prompt-block">
      <h3 id={headingId}>Starting prompt for {shipName}</h3>
      <p>Paste it into a new session. It is shown only now: the secret in it cannot be read again.</p>
      <pre data-testid="starting-prompt-text">{prompt}</pre>
      <button
        type="button"
        data-testid="starting-prompt-copy"
        onClick={() => {
          void copy();
        }}
      >
        Copy
      </button>
      <button type="button" onClick={onDone}>
        Done
      </button>
      <p role="status">{COPY_MESSAGES[copyState]}</p>
    </section>
  );
}
