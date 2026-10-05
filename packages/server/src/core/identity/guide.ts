import type { GuideProgressState, NoticeAudience } from '@aeolus-fleet/common';

/** A guide's step (decision 0024): a console page, the element it points at (centred without one), a title and a text. */
export interface GuideStep {
  path: string;
  anchor?: string;
  title: string;
  text: string;
}

/**
 * The guide (decision 0024): steps the installation sets for the console
 * sessions of one audience. Its shape is checked where the installation sets
 * it (`setGuideInputSchema`); here it is trusted.
 */
export interface Guide {
  audience: NoticeAudience;
  steps: readonly GuideStep[];
}

/** Where a console session is in the guide: open at a step, counted from 0, or skipped or finished. */
export interface GuideProgress {
  step: number;
  state: GuideProgressState;
}

/** A session that has not moved in the guide yet: open at its first step, so the guide opens by itself. */
export const NOT_STARTED: GuideProgress = { step: 0, state: 'open' };
