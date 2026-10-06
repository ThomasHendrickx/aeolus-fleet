'use client';

import type { CrewLine } from '@aeolus-fleet/common';
import { useState } from 'react';

import { crewLineHarnessWord } from '../../lib/harness';
import { CopyButton } from '../atoms/copy-button';
import { Tabs, TabsList, TabsTrigger } from '../atoms/tabs';

interface CompactCrewLineProps {
  /** One line per harness, as squadrons issued them: Claude Code, Codex, and Chat. */
  crewLines: readonly CrewLine[];
  /** What they crew, for the switch's and copy button's names: a member name. */
  subject: string;
  /** The shown line's test id is `<prefix>-<harness>`, its copy button's `<prefix>-<harness>-copy`, each switch tab's `<prefix>-<harness>-tab`. */
  testIdPrefix: string;
  onCopied?: () => void;
  onCopyFailed?: () => void;
}

/**
 * A member's crew lines in one row: a harness switch (the first issued, Claude
 * Code, until another is chosen), the chosen line on one line, and one copy
 * button that copies it whole. A squadron's members fit on one page this way.
 */
export function CompactCrewLine({ crewLines, subject, testIdPrefix, onCopied, onCopyFailed }: CompactCrewLineProps) {
  const [harness, setHarness] = useState(crewLines[0]?.harness);
  const shown = crewLines.find((each) => each.harness === harness) ?? crewLines[0];
  if (!shown) {
    return null;
  }
  const word = crewLineHarnessWord(shown.harness);
  return (
    <div className="flex min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
      <Tabs
        value={shown.harness}
        onValueChange={(next: unknown) => {
          const chosen = crewLines.find((each) => each.harness === next);
          if (chosen) {
            setHarness(chosen.harness);
          }
        }}
      >
        <TabsList aria-label={`Crew ${subject} from`}>
          {crewLines.map((each) => (
            <TabsTrigger key={each.harness} value={each.harness} data-testid={`${testIdPrefix}-${each.harness}-tab`}>
              {crewLineHarnessWord(each.harness)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <code
        data-testid={`${testIdPrefix}-${shown.harness}`}
        title={shown.line}
        className="min-w-0 grow truncate rounded-md bg-muted px-2 py-1 font-mono text-code text-foreground"
      >
        {shown.line}
      </code>
      <CopyButton
        value={shown.line}
        label={`Copy the ${word} crew line for ${subject}`}
        isLabeled
        onCopied={onCopied}
        onCopyFailed={onCopyFailed}
        data-testid={`${testIdPrefix}-${shown.harness}-copy`}
      />
    </div>
  );
}
