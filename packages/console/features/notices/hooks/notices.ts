import type { NoticeLink } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { showToast } from '../../../components/atoms/toast';
import type { Notice } from '../molecules/notice-banner';
import { useSignOut } from '../../../lib/session';
import { useTRPC } from '../../../lib/trpc';

/** Where a link that signs out goes once the session ended: its url, or sign in when it has none. */
export function afterSignOutOf(link: NoticeLink): string {
  return link.url ?? '/sign-in';
}

/**
 * The notices this console session shows (decision 0023), Dismiss for the
 * dismissible ones, and links that sign out: the session ends, then the
 * browser goes to the link's url or to sign in. A failure says so in a toast,
 * and the notice stays.
 */
export function useConsoleNotices(): { notices: Notice[]; onDismiss: (noticeId: string) => void; onSignOut: (link: NoticeLink) => void } {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const notices = useQuery(trpc.console.notices.queryOptions());
  const dismiss = useMutation(
    trpc.console.dismissNotice.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.console.notices.queryKey() }),
      onError: () => {
        showToast({ title: 'Couldn’t dismiss the notice', description: 'The server did not answer. Try again.', tone: 'error' });
      },
    }),
  );
  const { signOut } = useSignOut();

  return {
    notices: notices.data ?? [],
    onDismiss: (noticeId) => {
      dismiss.mutate({ noticeId });
    },
    onSignOut: (link) => {
      signOut(afterSignOutOf(link), () => {
        showToast({ title: 'Couldn’t sign out', description: 'The server did not answer. You are still signed in.', tone: 'error' });
      });
    },
  };
}
