'use client';

import { CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '../atoms/button';
import { CodeBlock } from '../atoms/code-block';

/**
 * A starting prompt, shown once: the operator copies it into a new session.
 * It holds the ship's secret, which the fleet never shows again, so nothing
 * here keeps it beyond this view. The copy button announces a copy; when the
 * clipboard refuses, the block says how to copy by hand.
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
  const [hasCopyFailed, setHasCopyFailed] = useState(false);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="starting-prompt-block"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-section font-semibold">
          Starting prompt for {shipName}
        </h3>
        <p className="text-meta text-muted-foreground">
          Paste it into a new session. It is shown only now: the secret in it cannot be read again.
        </p>
      </div>
      <CodeBlock
        label="Starting prompt"
        code={prompt}
        isWrapped
        copyLabel={`Copy the starting prompt for ${shipName}`}
        codeTestId="starting-prompt-text"
        copyTestId="starting-prompt-copy"
        onCopied={() => {
          setHasCopyFailed(false);
        }}
        onCopyFailed={() => {
          setHasCopyFailed(true);
        }}
      />
      <p role="status" className="flex items-center gap-1.5 text-meta text-destructive-text empty:hidden">
        {hasCopyFailed ? (
          <>
            <CircleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
            Could not copy: select the text and copy it by hand.
          </>
        ) : null}
      </p>
      <div className="flex justify-end">
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
