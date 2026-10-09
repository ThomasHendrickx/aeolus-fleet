'use client';

import { ArrowRight, Flag } from 'lucide-react';
import { useState } from 'react';

import type { BlueprintVersion } from '../../lib/squadrons-schemas';
import { classNames } from '../../lib/class-names';
import { Badge } from '../atoms/badge';

/** The name a blueprint binds a hand-off to when it goes to the squadron's flagship. */
const FLAGSHIP = 'flagship';

function HandoffEnd({ name, count, onHover }: { name: string; count: number | undefined; onHover: (role: string | undefined) => void }) {
  const hover = {
    onPointerEnter: () => {
      onHover(name);
    },
    onPointerLeave: () => {
      onHover(undefined);
    },
  };
  return name === FLAGSHIP ? (
    <Badge variant="kind" {...hover}>
      <Flag aria-hidden />
      flagship
    </Badge>
  ) : (
    <Badge variant="type" {...hover}>
      {name}
      {count !== undefined && count > 1 && <span className="text-muted-foreground">×{count}</span>}
    </Badge>
  );
}

/**
 * Who hands work to whom, read from the blueprint
 * (docs/design/png/HandoffWiring.png): role, hand-off, role, with each role's
 * count. Read only; wiring is edited in git. The flagship is the squadron's
 * entry and exit. Pointing at a role marks the hand-offs it takes part in.
 */
export function HandoffWiring({ blueprint }: { blueprint: BlueprintVersion }) {
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const counts = new Map(blueprint.roles.map((role) => [role.name, role.count]));

  return (
    <section aria-labelledby="handoff-wiring" data-testid="handoff-wiring" className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="handoff-wiring" className="text-body font-semibold">
          Hand-offs
        </h2>
        <span className="text-meta text-muted-foreground">
          from blueprint {blueprint.name} v{blueprint.version}
        </span>
      </div>
      {blueprint.handoffs.length === 0 ? (
        <p className="text-meta text-muted-foreground">No hand-offs. Members only hear from the flagship and from each other by name.</p>
      ) : (
        <ul className="grid grid-cols-[auto_auto_1fr] items-center gap-x-4 text-meta">
          {blueprint.handoffs.map((handoff) => (
            <li
              key={`${handoff.role}.${handoff.handoff}`}
              data-testid="handoff-row"
              className={classNames(
                'col-span-3 grid grid-cols-subgrid items-center rounded-md px-1.5 py-1',
                hovered !== undefined && (handoff.role === hovered || handoff.to === hovered) ? 'bg-muted' : undefined,
              )}
            >
              <span>
                <HandoffEnd name={handoff.role} count={counts.get(handoff.role)} onHover={setHovered} />
              </span>
              <span className="flex items-center gap-1 font-mono text-muted-foreground">
                {handoff.handoff}
                <ArrowRight aria-label="goes to" className="size-(--size-icon-sm)" />
              </span>
              <span>
                <HandoffEnd name={handoff.to} count={counts.get(handoff.to)} onHover={setHovered} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
