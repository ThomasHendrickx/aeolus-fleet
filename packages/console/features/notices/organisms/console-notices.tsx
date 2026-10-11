'use client';

import { NoticeBanner } from '../molecules/notice-banner';
import { useConsoleNotices } from '../hooks/notices';

/** The notices of this console session, one banner each, in the installation's order (decision 0023). */
export function ConsoleNotices() {
  const { notices, onDismiss, onSignOut } = useConsoleNotices();
  if (notices.length === 0) {
    return null;
  }
  return (
    <div data-testid="notices">
      {notices.map((notice) => (
        <NoticeBanner
          key={notice.id}
          notice={notice}
          onDismiss={() => {
            onDismiss(notice.id);
          }}
          onSignOut={onSignOut}
        />
      ))}
    </div>
  );
}
