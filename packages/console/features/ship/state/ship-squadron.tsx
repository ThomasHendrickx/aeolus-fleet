'use client';

import type { ShipId } from '@aeolus-fleet/common';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { duration } from '../../../lib/relative-time';
import { useCatalogue, useSquadrons } from '../../../lib/squadrons-api';
import { blueprintPath, checkInText, handoffsOf, handoffsText, templatePath } from '../../../lib/squadrons-view';
import { Button } from '../../../components/atoms/button';
import { HealthIndicator } from '../../../components/molecules/health-indicator';
import { StatusBadge } from '../../../components/molecules/status-badge';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3.5 py-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5 text-body text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A ship's place in a squadron, on its page (canvas SqMemberShip and
 * SqFlagship): for a flagship, what it is, why it cannot be released, renamed
 * or retired, and Open squadron; for a member, an alert while it is silent, and
 * its squadron, role and template, health and hand-offs. Nothing for a ship
 * in no squadron, or while squadrons is off or not connected.
 */
export function ShipSquadron({ shipId, now }: { shipId: ShipId; now: Date }) {
  const squadrons = useSquadrons();
  const catalogue = useCatalogue();
  const squadron = squadrons.data?.find((each) => each.flagship.shipId === shipId || each.members.some((member) => member.shipId === shipId));
  if (!squadron) {
    return null;
  }
  const squadronLink = (
    <Link href={`/squadrons/${squadron.id}`} className="font-mono hover:underline" data-testid="ship-squadron-link">
      {squadron.id}
    </Link>
  );
  if (squadron.flagship.shipId === shipId) {
    return (
      <div role="note" data-testid="ship-flagship-note" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-3.5 py-3 text-meta text-foreground">
        <span className="grow">
          Flagship of squadron {squadronLink}: the address for work sent to the team. The squadron manager crews it, so it can’t be released, renamed or retired; it retires when the squadron disbands.
        </span>
        <Button size="xs" nativeButton={false} render={<Link href={`/squadrons/${squadron.id}`} />} data-testid="ship-open-squadron">
          Open squadron
        </Button>
      </div>
    );
  }
  const member = squadron.members.find((each) => each.shipId === shipId);
  if (!member) {
    return null;
  }
  const blueprint = catalogue.data?.blueprints.find(
    (each) => each.repository === squadron.blueprint.repository && each.name === squadron.blueprint.name && each.version === squadron.blueprint.version,
  );
  const template = blueprint?.roles.find((role) => role.name === member.role)?.template;
  const silentFor = member.crew.lastSeenAt === null ? undefined : duration(new Date(member.crew.lastSeenAt), now);
  return (
    <div className="flex flex-col gap-3">
      {member.health === 'silent' && squadron.state !== 'disbanded' && (
        <div role="alert" data-testid="ship-silent-alert" className="rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-foreground">
          <strong className="font-semibold text-tone-attention-fg">{silentFor === undefined ? 'Silent.' : `Silent: not seen for ${silentFor}.`}</strong> It checks in{' '}
          {checkInText(member.checkInMinutes)}, so its session has probably stopped. Get a new crew line and start a new session; the old crew line then stops
          working.
        </div>
      )}
      <dl data-testid="ship-squadron-facts" className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border max-sm:grid-cols-2">
        <Fact label="Squadron">
          {squadronLink}
          <StatusBadge status={squadron.state} />
        </Fact>
        <Fact label="Role and template">
          <span className="rounded-sm bg-secondary px-1.5 font-mono text-id">{member.role}</span>
          {template && (
            <Link href={templatePath(template)} className="font-mono text-meta hover:underline">
              {template.name}@{template.version}
            </Link>
          )}
        </Fact>
        <Fact label="Health">
          <HealthIndicator health={member.health} detail={member.health === 'silent' || member.health === 'late' ? silentFor : undefined} />
        </Fact>
        <Fact label="Hand-offs">
          {blueprint ? (
            <span className="text-meta">{handoffsText(handoffsOf(blueprint, member.role))}</span>
          ) : (
            <Link href={blueprintPath(squadron.blueprint)} className="text-meta text-muted-foreground hover:underline">
              See its blueprint
            </Link>
          )}
        </Fact>
      </dl>
    </div>
  );
}
