import { SquareTerminal } from 'lucide-react';

import { classNames } from '../../lib/class-names';
import { CopyButton } from './copy-button';

interface CodeBlockProps {
  /** What the code is: "JSON · 50 bytes", "Starting prompt". */
  label: string;
  code: string;
  /** Long single lines wrap anywhere: on phone and in prompts. */
  isWrapped?: boolean;
  /** What the copy button copies, when not the code as shown. */
  copyValue?: string;
  /** The accessible name of the copy button: "Copy starting prompt". */
  copyLabel?: string;
  onCopied?: () => void;
  onCopyFailed?: () => void;
  codeTestId?: string;
  copyTestId?: string;
}

/**
 * A composed atom (docs/design/png/CodeBlock.png): a header with the label and
 * a labelled CopyButton, the body in --text-code on --muted. Formatted JSON
 * keeps its indentation. Never syntax colour by status.
 */
export function CodeBlock({
  label,
  code,
  isWrapped = false,
  copyValue,
  copyLabel = `Copy ${label.toLowerCase()}`,
  onCopied,
  onCopyFailed,
  codeTestId,
  copyTestId,
}: CodeBlockProps) {
  return (
    <div data-slot="code-block" className="overflow-hidden rounded-lg border border-border bg-muted">
      <div className="flex h-9 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3">
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <SquareTerminal aria-hidden className="size-(--size-icon-sm) shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <CopyButton
          value={copyValue ?? code}
          label={copyLabel}
          isLabeled
          onCopied={onCopied}
          onCopyFailed={onCopyFailed}
          data-testid={copyTestId}
        />
      </div>
      <pre
        data-testid={codeTestId}
        className={classNames(
          'overflow-x-auto px-3 py-3 font-mono text-code text-foreground',
          isWrapped ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
        )}
      >
        {code}
      </pre>
    </div>
  );
}
