import type { ReportDetails as Details } from '@aeolus-fleet/common';
import { ChevronRight } from 'lucide-react';

import { reportDetailsJson, reportDetailsLabel } from '../../lib/report';
import { CodeBlock } from '../atoms/code-block';

/**
 * A report's details as the console shows a ship type it does not know
 * (decision 0028): folded, with their version in the summary; unfolded, their
 * JSON raw in a CodeBlock with its size. Keyboard reachable as a native
 * disclosure.
 */
export function ReportDetails({ details, version, testId }: { details: Details; version: number; testId: string }) {
  return (
    <details data-testid={testId} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2.5 text-meta text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-(--size-icon-sm) shrink-0 transition-transform group-open:rotate-90" />
        <span className="font-medium text-foreground">Report details</span>
        <span className="tabular-nums">· version {version}</span>
      </summary>
      <div className="px-3.5 pb-3.5">
        <CodeBlock label={reportDetailsLabel(details)} code={reportDetailsJson(details)} copyLabel="Copy report details" codeTestId={`${testId}-code`} />
      </div>
    </details>
  );
}
