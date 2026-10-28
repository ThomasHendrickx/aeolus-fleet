import { Info } from 'lucide-react';

import { CodeBlock } from '../../../../components/atoms/code-block';

interface SetupLineBlockProps {
  /** The machine's name, which its trierarch's ship goes by. */
  name: string;
  setupLine: string;
  /** The test ids of the line and its copy button, by the dialog that shows it. */
  testIdPrefix: string;
  onCopied: () => void;
  onCopyFailed: () => void;
}

/**
 * A machine's setup line, shown once with its copy button: it carries the
 * ship's secret. Joining and a new setup line (#1239) show it alike; a lost
 * one is got again on the machine's card.
 */
export function SetupLineBlock({ name, setupLine, testIdPrefix, onCopied, onCopyFailed }: SetupLineBlockProps) {
  return (
    <>
      <p className="flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-meta text-foreground">
        <Info aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">Shown once. Copy it now.</span> It carries the ship’s secret. If you lose it, get a new setup line on {name}’s card.
        </span>
      </p>
      <CodeBlock
        label="Setup line"
        code={setupLine}
        isWrapped
        copyLabel={`Copy the setup line for ${name}`}
        codeTestId={`${testIdPrefix}-setup-line`}
        copyTestId={`${testIdPrefix}-setup-line-copy`}
        onCopied={onCopied}
        onCopyFailed={onCopyFailed}
      />
    </>
  );
}
