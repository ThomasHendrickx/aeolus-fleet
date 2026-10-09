'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { Copy, Ellipsis, KeyRound, SquarePen, SquareArrowOutUpRight, UserMinus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { Squadron } from '../../lib/squadrons-schemas';
import { Button } from '../atoms/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../atoms/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../atoms/sheet';
import { showToast } from '../atoms/toast';
import { ComposeMessage } from './compose-message';
import { useNewCrewLineFlow } from './get-new-crew-line';

interface MemberActionsProps {
  squadronId: string;
  member: Squadron['members'][number];
  ship: ShipDetail | undefined;
  /** Its template, as "tester@4", for the crew line's launch note heading. */
  template?: string;
  /** Whether the session may manage the fleet: a new crew line and removing need it. */
  canManage: boolean;
  /** Whether the session may send: Message needs it. */
  canSend: boolean;
  /** Whether the squadron's state lets it lose members (Sailing or Standing down). */
  isRemovable: boolean;
  onRemove: () => void;
}

interface MemberAction {
  key: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  href?: string;
  isDestructive?: boolean;
  /** Not yet possible: shown, but it waits (Get new crew line until the member's ship has loaded). */
  isDisabled?: boolean;
  onSelect?: () => void;
}

/**
 * A member's actions (canvas, SqMemberMenu): a primary Get new crew line on a
 * silent member's row, and its menu, a DropdownMenu on desktop and a bottom
 * Sheet on phone: Open ship page, Message, Get new crew line and Copy ship id,
 * and, apart, Remove from squadron. No Release: a new crew line is how a
 * member gets a new session (docs/squadrons.md). A viewer's session opens the
 * page and copies the id only.
 */
export function MemberActions({ squadronId, member, ship, template, canManage, canSend, isRemovable, onRemove }: MemberActionsProps) {
  const [isComposing, setIsComposing] = useState(false);
  const isRetired = member.crew.status === 'retired' || ship?.status === 'retired';
  const flow = useNewCrewLineFlow(canManage && !isRetired ? { squadronId, member, ship, template } : undefined);
  const copyId = async () => {
    // The clipboard is missing outside a secure context, and may refuse: either way the id is shown to copy by hand.
    try {
      await navigator.clipboard.writeText(member.shipId);
      showToast({ title: 'Ship id copied', description: member.shipId, tone: 'success' });
    } catch {
      showToast({ title: 'Couldn’t copy the ship id', description: member.shipId, tone: 'error' });
    }
  };
  const actions: MemberAction[] = [
    { key: 'open', label: 'Open ship page', icon: SquareArrowOutUpRight, testId: 'member-open-ship', href: `/ships/${member.shipId}` },
    ...(canSend && !isRetired ? [{ key: 'message', label: 'Message…', icon: SquarePen, testId: 'member-message', onSelect: () => { setIsComposing(true); } }] : []),
    ...(canManage && !isRetired ? [{ key: 'crew-line', label: 'Get new crew line…', icon: KeyRound, testId: 'member-new-crew-line', isDisabled: !flow.isReady, onSelect: flow.start }] : []),
    { key: 'copy', label: 'Copy ship id', icon: Copy, testId: 'member-copy-id', onSelect: () => void copyId() },
  ];
  const removal: MemberAction | undefined =
    canManage && isRemovable && !isRetired
      ? { key: 'remove', label: 'Remove from squadron…', icon: UserMinus, testId: 'member-remove', isDestructive: true, onSelect: onRemove }
      : undefined;
  const trigger = (size: 'xs' | 'touch') => (
    <Button size={size} variant="ghost" isIconOnly aria-label={`Actions for ${member.name}`} icon={<Ellipsis />} data-testid="member-actions" />
  );
  return (
    <span className="flex shrink-0 items-center gap-1">
      {canManage && !isRetired && member.health === 'silent' && (
        <Button size="xs" disabled={!flow.isReady} data-testid="member-new-crew-line-primary" onClick={flow.start}>
          Get new crew line
        </Button>
      )}
      <span className="max-sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger render={trigger('xs')} />
          <DropdownMenuContent align="end">
            {actions.map((action) =>
              action.href === undefined ? (
                <DropdownMenuItem key={action.key} disabled={action.isDisabled} onClick={action.onSelect} data-testid={action.testId}>
                  <action.icon aria-hidden />
                  {action.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={action.key} render={<Link href={action.href} />} data-testid={action.testId}>
                  <action.icon aria-hidden />
                  {action.label}
                </DropdownMenuItem>
              ),
            )}
            {removal && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={removal.onSelect} data-testid={removal.testId}>
                  <removal.icon aria-hidden />
                  {removal.label}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <span className="sm:hidden">
        <Sheet>
          <SheetTrigger render={trigger('touch')} />
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{member.name}</SheetTitle>
            </SheetHeader>
            <ul className="flex flex-col pb-2">
              {[...actions, ...(removal ? [removal] : [])].map((action) => (
                <li key={action.key} className={action.isDestructive === true ? 'mt-1 border-t border-border pt-1' : undefined}>
                  <SheetClose
                    render={action.href === undefined ? <button type="button" disabled={action.isDisabled} onClick={action.onSelect} /> : <Link href={action.href} />}
                    className={`flex h-(--size-control-touch) w-full items-center gap-3 px-4 text-left text-body-touch disabled:opacity-45 [&_svg]:size-(--size-icon) [&_svg]:shrink-0 ${action.isDestructive === true ? 'text-destructive-text' : 'text-foreground'}`}
                  >
                    <action.icon aria-hidden />
                    {action.label.replace(/…$/, '')}
                  </SheetClose>
                </li>
              ))}
            </ul>
            <div className="px-4 pb-4">
              <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </span>
      {flow.dialog}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} toShipId={member.shipId} />
    </span>
  );
}
