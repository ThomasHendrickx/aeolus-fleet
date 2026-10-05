'use client';

import { useConsoleGuide, useGuideAnchor } from '../../lib/guide';
import { TourStep } from '../molecules/tour-step';

/** The installation's guide for this console session (decision 0024): the step it is at, while the guide is open. */
export function ConsoleGuide() {
  const { view, onBack, onNext, onSkip, onFinish } = useConsoleGuide();
  const anchor = useGuideAnchor(view?.step);
  if (!view) {
    return null;
  }
  return (
    <TourStep
      title={view.step.title}
      text={view.step.text}
      index={view.index}
      total={view.total}
      anchor={anchor}
      onBack={onBack}
      onNext={onNext}
      onSkip={onSkip}
      onFinish={onFinish}
    />
  );
}
