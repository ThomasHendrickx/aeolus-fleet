'use client';

import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { LayoutGrid, List } from 'lucide-react';

import { classNames } from '@aeolus-fleet/ui';
import type { FleetViewMode } from '../../services/fleet-filter';

const MODES = [
  { mode: 'cards', word: 'Cards', Icon: LayoutGrid },
  { mode: 'list', word: 'List', Icon: List },
] as const;

function isMode(value: unknown): value is FleetViewMode {
  return MODES.some(({ mode }) => mode === value);
}

/**
 * The overview's switch between Harbour's cards and the fleet table
 * (docs/design/fleet-overview): a radio group, arrow keys move. Words and
 * icons on desktop; icons alone, at touch size, on the phone.
 */
export function ViewSwitch({ mode, onModeChange, size = 'sm' }: { mode: FleetViewMode; onModeChange: (mode: FleetViewMode) => void; size?: 'sm' | 'touch' }) {
  const isTouch = size === 'touch';
  return (
    <RadioGroupPrimitive
      aria-label="View"
      value={mode}
      onValueChange={(value) => {
        if (isMode(value)) {
          onModeChange(value);
        }
      }}
      data-testid={isTouch ? 'fleet-view-switch-touch' : 'fleet-view-switch'}
      className={classNames('inline-flex shrink-0 gap-0.5 border border-border bg-muted p-0.5', isTouch ? 'rounded-[10px]' : 'rounded-md')}
    >
      {MODES.map(({ mode: each, word, Icon }) => (
        <Radio.Root
          key={each}
          value={each}
          aria-label={isTouch ? word : undefined}
          data-testid={`fleet-view-${each}`}
          className={classNames(
            'inline-flex cursor-pointer items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-checked:bg-card data-checked:text-foreground data-checked:shadow-sm',
            isTouch ? 'h-9.5 w-10 rounded-lg [&_svg]:size-4.5' : 'h-6.5 gap-1.5 rounded-sm px-2.5 text-meta leading-none font-medium [&_svg]:size-3.5',
          )}
        >
          <Icon aria-hidden />
          {isTouch ? null : word}
        </Radio.Root>
      ))}
    </RadioGroupPrimitive>
  );
}
