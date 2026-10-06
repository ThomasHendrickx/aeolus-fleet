'use client';

import { Button } from '../atoms/button';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle } from '../atoms/popover';

export interface TourStepProps {
  title: string;
  text: string;
  /** The step's place, counted from 0, and how many steps the guide has: "3 of 6". */
  index: number;
  total: number;
  /** The element the step points at; null shows the step centred on the page (decision 0024). */
  anchor: Element | null;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

function StepBody({ index, total, onBack, onNext, onSkip, onFinish, children }: Omit<TourStepProps, 'anchor' | 'title' | 'text'> & { children: React.ReactNode }) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-4">
      <p className="text-caption text-muted-foreground" data-testid="tour-step-count">
        {index + 1} of {total}
      </p>
      {children}
      <div className="mt-2 flex items-center gap-2">
        {isLast ? null : (
          <Button size="sm" variant="ghost" data-testid="tour-step-skip" onClick={onSkip}>
            Skip
          </Button>
        )}
        <span className="grow" />
        {isFirst ? null : (
          <Button size="sm" data-testid="tour-step-back" onClick={onBack}>
            Back
          </Button>
        )}
        {isLast ? (
          <Button size="sm" variant="primary" data-testid="tour-step-finish" onClick={onFinish}>
            Finish
          </Button>
        ) : (
          <Button size="sm" variant="primary" data-testid="tour-step-next" onClick={onNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A step of the guide (decision 0024): its place, title and text, with Skip,
 * Back, and Next or Finish on the last. It points at its anchor; without one
 * on the page it shows centred, pointing at nothing. It stays until the
 * operator moves on: clicking elsewhere does not close it.
 */
export function TourStep(props: TourStepProps) {
  const { title, text, anchor } = props;
  if (anchor === null) {
    return (
      <div
        role="dialog"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-text"
        data-testid="tour-step"
        data-placement="centred"
        className="fixed top-1/2 left-1/2 z-50 -translate-1/2 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <StepBody {...props}>
          <h2 id="tour-step-title" className="text-body font-semibold text-foreground">
            {title}
          </h2>
          <p id="tour-step-text" className="text-body text-muted-foreground">
            {text}
          </p>
        </StepBody>
      </div>
    );
  }
  return (
    <Popover open modal={false}>
      <PopoverContent anchor={anchor} data-testid="tour-step" data-placement="anchored">
        <StepBody {...props}>
          <PopoverTitle className="text-body font-semibold text-foreground">{title}</PopoverTitle>
          <PopoverDescription className="text-body text-muted-foreground">{text}</PopoverDescription>
        </StepBody>
      </PopoverContent>
    </Popover>
  );
}
