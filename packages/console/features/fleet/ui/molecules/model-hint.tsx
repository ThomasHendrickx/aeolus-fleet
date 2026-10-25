import type { ListedShip } from '@aeolus-fleet/common';

import { modelStatedWords } from '../../../../lib/model-tag';
import { Tooltip, TooltipContent, TooltipTrigger } from '@aeolus-fleet/common/header';

/** The overview's quiet model hint; the full ModelTag remains on the ship page. */
export function ModelHint({ model, now }: { model: NonNullable<ListedShip['model']>; now: Date }) {
  const stated = modelStatedWords(model, now);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span data-testid="fleet-model-hint" className="min-w-0 truncate font-mono text-id text-muted-foreground" />}
      >
        {model.id}
        <span className="sr-only">, {stated}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col gap-0.5">
          <span className="font-mono">{model.id}</span>
          <span>{stated}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
