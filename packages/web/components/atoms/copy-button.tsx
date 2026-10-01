'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from './button';

/** How long the check shows after a copy. */
const COPIED_FOR_MS = 1_500;

interface CopyButtonProps {
  /** The full value, copied even when the text shown is shortened. */
  value: string;
  /** What is copied, for the accessible name: "Copy ship id". */
  label: string;
  size?: 'xs' | 'touch';
  /** Shows "Copy" and "Copied" next to the icon. */
  isLabeled?: boolean;
  /** The clipboard refused: the caller says how to copy by hand. */
  onCopyFailed?: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * Composed on Button, ghost (docs/design/png/CopyButton.png). Shows a check
 * for 1.5 s and announces "Copied." politely.
 */
export function CopyButton({
  value,
  label,
  size = 'xs',
  isLabeled = false,
  onCopyFailed,
  className,
  'data-testid': testId,
}: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onCopyFailed?.();
      return;
    }
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, COPIED_FOR_MS);
  }

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        isIconOnly={!isLabeled}
        aria-label={label}
        title={isLabeled ? undefined : label}
        icon={isCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
        className={className}
        data-testid={testId}
        onClick={() => {
          void copy();
        }}
      >
        {isLabeled ? (isCopied ? 'Copied' : 'Copy') : null}
      </Button>
      <span role="status" className="sr-only">
        {isCopied ? 'Copied.' : ''}
      </span>
    </>
  );
}
