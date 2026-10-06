'use client';

import { Archive, CircleCheck, TriangleAlert, Users } from 'lucide-react';
import { useState } from 'react';

import { abandonedLine, isTypedMatch } from '../../lib/ship-dialogs';
import { counted } from '../../lib/sentence';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../atoms/alert-dialog';
import { Button } from '../atoms/button';
import { dialogSurface } from '../atoms/dialog-surface';
import { ConsequenceList } from '../molecules/consequence-list';
import { InlineError } from '../molecules/inline-error';
import { TypedConfirm } from '../molecules/typed-confirm';

const DELIVERIES = { one: 'delivery', many: 'deliveries' };

interface RemoveMemberDialogProps {
  squadronId: string;
  member: { name: string; role: string };
  /** The members of its role that stay, by name: none when it is the last of its role. */
  othersOfRole: readonly string[];
  /** The blueprint version it formed from, as "aeolus v3", and how many of the role it forms; none when the catalogue no longer has it. */
  blueprint?: { label: string; count: number };
  /** The open deliveries its inbox holds, and how many of them are in flight. */
  openDeliveries: number;
  inFlightDeliveries: number;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why removing failed, as the squadron manager said it. */
  error?: string;
  onConfirm: () => void;
}

function afterText({ role, othersOfRole, blueprint }: Pick<RemoveMemberDialogProps, 'othersOfRole' | 'blueprint'> & { role: string }): string {
  const after = othersOfRole.length === 0 ? `no ${role}` : `${String(othersOfRole.length)} ${role}`;
  return blueprint === undefined ? `The squadron then has ${after}.` : `The squadron then has ${after}; blueprint ${blueprint.label} has ${String(blueprint.count)}.`;
}

/** The open dialog's body: its typed text lives here, so it starts empty each time the dialog opens. */
function RemoveMemberBody(props: RemoveMemberDialogProps) {
  const { squadronId, member, othersOfRole, blueprint, openDeliveries, inFlightDeliveries, isPending, error, onConfirm } = props;
  const [typed, setTyped] = useState('');
  const isTypingNeeded = openDeliveries > 0;
  const isConfirmed = !isTypingNeeded || isTypedMatch(member.name, typed);
  const isLastOfRole = othersOfRole.length === 0;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Remove {member.name} from {squadronId}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {isTypingNeeded ? <>Its ship is retired for good. This can&apos;t be undone.</> : <>This can&apos;t be undone. Add a member to get the role back.</>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {isTypingNeeded ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-meta text-tone-attention-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">{abandonedLine(openDeliveries)}</p>
            <p className="text-foreground">
              {openDeliveries - inFlightDeliveries} pending, {inFlightDeliveries} in flight in its inbox. Each is marked Abandoned and its sender can see that.
            </p>
          </div>
        </div>
      ) : (
        <ConsequenceList
          consequences={[
            { icon: Archive, text: `Its ship ${member.name} is retired. Its history stays read-only.` },
            { icon: Users, text: afterText({ role: member.role, othersOfRole, blueprint }) },
          ]}
        />
      )}
      {isLastOfRole && (
        <p data-testid="remove-member-last-of-role" className="flex items-start gap-2 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          <span>
            <span className="font-medium">The last {member.role}.</span>{' '}
            <span className="text-foreground">
              {afterText({ role: member.role, othersOfRole, blueprint })} Work for the role waits until a member is added.
            </span>
          </span>
        </p>
      )}
      {!isTypingNeeded && (
        <p className="flex items-center gap-2 rounded-lg border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg">
          <CircleCheck aria-hidden className="size-(--size-icon-sm) shrink-0" />
          Its inbox is empty, so no deliveries are affected.
        </p>
      )}
      {isTypingNeeded ? <TypedConfirm expected={member.name} value={typed} onValueChange={setTyped} /> : null}
      {error !== undefined && <InlineError title="Couldn’t remove the member" description={`${error} Nothing changed.`} />}
      <AlertDialogFooter>
        <AlertDialogClose render={<Button disabled={isPending} />}>Cancel</AlertDialogClose>
        <Button variant="destructive" isLoading={isPending} disabled={!isConfirmed} onClick={onConfirm} data-testid="remove-member-confirm">
          {isTypingNeeded ? `Remove and abandon ${counted(openDeliveries, DELIVERIES)}` : 'Remove member'}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Removes a member (docs/design/png/RemoveMemberDialog.png): its ship
 * retires, so it follows the RetireDialog: one normal confirm when its inbox
 * is clean, the TypedConfirm with the ship name when it would abandon
 * deliveries. It warns when the member is the last of its role.
 * Desktop: a dialog; phone: a bottom sheet.
 */
export function RemoveMemberDialog(props: RemoveMemberDialogProps) {
  const { isOpen, onOpenChange, isPending } = props;
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <AlertDialogContent data-testid="remove-member-dialog" className={dialogSurface.phoneSheet}>
        <RemoveMemberBody {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
