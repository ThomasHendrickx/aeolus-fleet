import type { UsageTotals } from '../../services/usage-chart';
import { tokensWords, usdWords } from '../../services/usage-format';

interface UsageTotalsProps {
  totals: UsageTotals;
  /** What the range is, in words: "last 7 days". */
  rangeWords: string;
}

function Metric({ label, value, caption, testId }: { label: string; value: string; caption: string; testId: string }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-metric font-semibold tabular-nums">{value}</span>
      <span className="text-caption text-muted-foreground">{caption}</span>
    </div>
  );
}

/**
 * The totals for the range (usage design, "The console"): all four token kinds
 * added up, and the estimated cost with the tokens no price covers named.
 */
export function UsageTotalsBlock({ totals, rangeWords }: UsageTotalsProps) {
  const unpriced =
    totals.unpricedTokens > 0 ? `${tokensWords(totals.unpricedTokens)} tokens not priced (${totals.unpricedModels.join(', ')})` : 'Every model priced';
  return (
    <div className="flex flex-wrap gap-x-7 gap-y-3" data-testid="usage-totals">
      <Metric label="Tokens" value={tokensWords(totals.tokens)} caption={rangeWords} testId="usage-total-tokens" />
      <Metric label="Estimated cost" value={usdWords(totals.estimatedCostUsd)} caption={unpriced} testId="usage-total-cost" />
    </div>
  );
}
