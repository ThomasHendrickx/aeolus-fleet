/**
 * The Fleet overview's sealing entry: gone while the fleet's sealing flag is
 * off (decision 0069), else Manage sealing with fleet:keys and View sealing
 * without (decision 0068, N5).
 */
export type SealingEntry = 'off' | 'manage' | 'view';

export function sealingEntryOf(session: { isSealingOn: boolean; canChangeKeys: boolean }): SealingEntry {
  if (!session.isSealingOn) {
    return 'off';
  }
  return session.canChangeKeys ? 'manage' : 'view';
}
