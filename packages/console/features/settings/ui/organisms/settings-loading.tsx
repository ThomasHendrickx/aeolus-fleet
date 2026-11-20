import { LoadingSkeleton } from '@aeolus-fleet/ui';

/** Settings before what it shows is read: its sections' shape under the title (docs/design/conventions.md, loading). */
export function SettingsLoading() {
  return <LoadingSkeleton variant="list" rows={3} label="Loading Settings" />;
}
