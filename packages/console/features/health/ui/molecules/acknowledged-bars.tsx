interface AcknowledgedBarsProps {
  /** Acknowledged in each hour of the last 24, oldest first. */
  perHour: readonly { at: string; count: number }[];
}

/**
 * The deliveries acknowledged in each hour of the last 24 (mock-up A): one
 * bar per hour in the ok tone, the highest hour full height. A count of
 * deliveries that reached their ships, so the delivering line has its shape.
 */
export function AcknowledgedBars({ perHour }: AcknowledgedBarsProps) {
  const highest = Math.max(1, ...perHour.map((hour) => hour.count));
  return (
    <div
      role="img"
      aria-label={`Acknowledged per hour over the last 24 hours, at most ${Math.max(0, ...perHour.map((hour) => hour.count))} in an hour`}
      data-testid="health-acknowledged-bars"
      className="flex h-8 w-full items-end gap-0.5 sm:w-48"
    >
      {perHour.map((hour) => (
        <span
          key={hour.at}
          className="min-h-0.5 flex-1 rounded-xs bg-tone-ok-fg opacity-75"
          style={{ height: `${(hour.count / highest) * 100}%` }}
        />
      ))}
    </div>
  );
}
