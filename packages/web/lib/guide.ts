import type { consoleGuideOutputSchema, GuideStep } from '@aeolus-fleet/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type { z } from 'zod';

import { showToast } from '../components/atoms/toast';
import { useTRPC } from './trpc';

type ConsoleGuide = z.output<typeof consoleGuideOutputSchema>;
type GuideProgress = NonNullable<ConsoleGuide>['progress'];

/** The step a session shows, with its place in the guide; undefined while the guide is skipped or finished, or there is none. */
export interface GuideView {
  step: GuideStep;
  index: number;
  total: number;
}

/** The step to show (decision 0024): the session's, while the guide is open. */
export function guideViewOf(guide: ConsoleGuide | undefined): GuideView | undefined {
  if (guide?.progress.state !== 'open') {
    return undefined;
  }
  const step = guide.steps[guide.progress.step];
  return step === undefined ? undefined : { step, index: guide.progress.step, total: guide.steps.length };
}

/** A step's page without its query: what the current pathname is compared with. */
export function pathnameOf(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}

/** The step's anchor in this page, only when it is on its own page; null otherwise, which shows it centred. */
function anchorQuery(step: GuideStep, pathname: string): string | undefined {
  return step.anchor !== undefined && pathnameOf(step.path) === pathname ? `[data-testid="${step.anchor}"]` : undefined;
}

/** The first visible element the selector finds: a part hidden at this width (a desktop table on phone) points at nothing. */
function visibleElement(selector: string | undefined): Element | null {
  if (selector === undefined) {
    return null;
  }
  return [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0) ?? null;
}

/** Follows the page for the element: it can appear once its data loads, or show only at some widths. */
function subscribeToPage(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  window.addEventListener('resize', onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', onChange);
  };
}

/** The element a step points at, on this page: the page is an outside system the guide only reads. */
export function useGuideAnchor(step: GuideStep | undefined): Element | null {
  const pathname = usePathname();
  const selector = step ? anchorQuery(step, pathname) : undefined;
  return useSyncExternalStore(
    subscribeToPage,
    () => visibleElement(selector),
    () => null,
  );
}

/**
 * The guide this console session shows (decision 0024) and how to move in
 * it: Back and Next keep the step on the server and go to its page; Skip and
 * Finish hide it for the session; Take the tour opens it at the first step
 * again. A move shows at once and says so in a toast when the server refuses
 * it, then shows what the server keeps.
 */
export function useConsoleGuide(): {
  view: GuideView | undefined;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** Undefined while no guide is for the session: the account menu then offers no Take the tour. */
  onTakeTour: (() => void) | undefined;
} {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const guide = useQuery(trpc.console.guide.queryOptions());
  const queryKey = trpc.console.guide.queryKey();
  const record = useMutation(
    trpc.console.recordGuideProgress.mutationOptions({
      onMutate: (progress) => {
        queryClient.setQueryData(queryKey, (held) => (held ? { ...held, progress } : held));
      },
      onError: () => {
        showToast({ title: 'Couldn’t keep your place in the tour', description: 'The server did not answer. Try again.', tone: 'error' });
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    }),
  );
  const steps = guide.data?.steps ?? [];
  const at = guide.data?.progress.step ?? 0;
  const moveTo = (progress: GuideProgress) => {
    record.mutate(progress);
    const step = steps[progress.step];
    if (progress.state === 'open' && step !== undefined && pathnameOf(step.path) !== pathname) {
      router.push(step.path);
    }
  };

  return {
    view: guideViewOf(guide.data ?? undefined),
    onBack: () => {
      moveTo({ step: Math.max(at - 1, 0), state: 'open' });
    },
    onNext: () => {
      moveTo({ step: Math.min(at + 1, steps.length - 1), state: 'open' });
    },
    onSkip: () => {
      moveTo({ step: at, state: 'skipped' });
    },
    onFinish: () => {
      moveTo({ step: at, state: 'finished' });
    },
    onTakeTour: steps.length === 0 ? undefined : () => {
      moveTo({ step: 0, state: 'open' });
    },
  };
}
