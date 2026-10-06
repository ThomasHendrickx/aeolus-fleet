import type { CrewLine } from '@aeolus-fleet/common';

import { harnessWord } from '../../lib/harness';
import { CodeBlock } from '../atoms/code-block';

interface CrewLinesProps {
  /** One line per harness with the aeolus plugin, as the API issued them. */
  crewLines: readonly CrewLine[];
  /** What they crew, for the copy buttons' names: a ship or member name. */
  subject: string;
  /** Each block's test ids are `<prefix>-<harness>` and `<prefix>-<harness>-copy`. */
  testIdPrefix: string;
  onCopied?: () => void;
  onCopyFailed?: () => void;
}

/** A starting prompt's crew lines: one labelled copy block per harness, as Claude Code or Codex. */
export function CrewLines({ crewLines, subject, testIdPrefix, onCopied, onCopyFailed }: CrewLinesProps) {
  return crewLines.map(({ harness, line }) => (
    <CodeBlock
      key={harness}
      label={`Crew line, ${harnessWord(harness)} with the aeolus plugin`}
      code={line}
      isWrapped
      copyLabel={`Copy the ${harnessWord(harness)} crew line for ${subject}`}
      codeTestId={`${testIdPrefix}-${harness}`}
      copyTestId={`${testIdPrefix}-${harness}-copy`}
      onCopied={onCopied}
      onCopyFailed={onCopyFailed}
    />
  ));
}
