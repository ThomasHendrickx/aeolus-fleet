'use client';

import { Lock } from 'lucide-react';

import { Badge } from '../../../../components/atoms/badge';
import { Switch } from '../../../../components/atoms/switch';
import { InlineError } from '../../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../../components/molecules/loading-skeleton';
import type { BuiltInRow } from '../../services/built-in-rules';

export interface BuiltInNetworkRulesProps {
  /** Every built-in rule as the fleet answers it; undefined while not known. */
  rows: readonly BuiltInRow[] | undefined;
  /** Why the fleet could not answer them. */
  error?: string;
  onRetry?: () => void;
  /** While the viewer reading is being turned. */
  isTurning: boolean;
  /** Why turning the viewer reading failed, as the fleet says it. */
  turnError?: string;
  /** Turns the viewer reading on or off: argo's alone. */
  onViewerReadChange: (isOn: boolean) => void;
}

const TURNED_BY: Readonly<Record<Exclude<BuiltInRow['turnedBy'], 'never'>, string>> = {
  argo: 'You turn it on or off.',
  plugin: 'The networking plugin turns it off while your rules apply, and on for all-to-all.',
};

/**
 * The built-in rules on Network, first and apart from argo's own (decision
 * 0034): each with what it allows, as the fleet answers it. argo, the owner
 * and the answer are never off and show so, with no control; the viewer
 * reading has a switch, argo's; open per verb shows on or off, the
 * networking plugin's to turn. Props only.
 */
export function BuiltInNetworkRules({ rows, error, onRetry, isTurning, turnError, onViewerReadChange }: BuiltInNetworkRulesProps) {
  let content;
  if (error !== undefined) {
    content = <InlineError title="Couldn’t read the built-in rules" description={error} onRetry={onRetry} />;
  } else if (rows === undefined) {
    content = <LoadingSkeleton variant="list" rows={3} label="Loading the built-in rules" />;
  } else {
    content = (
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.key} data-testid="network-built-in-rule" className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body font-medium" data-testid="network-built-in-rule-name">
                {row.name}
              </span>
              <span className="text-meta text-muted-foreground">
                {row.meaning} {row.turnedBy === 'never' ? null : TURNED_BY[row.turnedBy]}
              </span>
            </div>
            {row.turnedBy === 'argo' ? (
              <Switch
                checked={row.isOn}
                disabled={isTurning}
                aria-label={`${row.name}: ${row.isOn ? 'on' : 'off'}`}
                data-testid="network-built-in-viewer-read"
                onCheckedChange={(isChecked) => {
                  onViewerReadChange(isChecked);
                }}
              />
            ) : (
              <Badge variant="outline" data-testid="network-built-in-rule-state">
                {row.turnedBy === 'never' ? (
                  <>
                    <Lock aria-hidden />
                    Never off
                  </>
                ) : row.isOn ? (
                  'On'
                ) : (
                  'Off'
                )}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="network-built-in" data-testid="network-built-in" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-built-in" className="text-body font-semibold">
        Built-in rules
      </h2>
      <p className="text-meta text-muted-foreground">The fleet&rsquo;s own rules, beside yours and the declared ones. They hold before any rule below.</p>
      {content}
      {turnError === undefined ? null : <InlineError variant="field" title="Couldn’t turn the viewer reading" description={turnError} />}
    </section>
  );
}
