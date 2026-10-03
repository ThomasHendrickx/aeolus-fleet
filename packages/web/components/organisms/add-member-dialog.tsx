'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';

import { checkInText, type RoleOption } from '../../lib/squadrons-view';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { InlineError } from '../molecules/inline-error';

interface AddMemberDialogProps {
  squadronId: string;
  /** The blueprint version it formed from, as "aeolus v3". */
  blueprint: string;
  roles: readonly RoleOption[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why adding failed, as the squadron manager said it. */
  error?: string;
  onSubmit: (role: string) => void;
}

function AddMemberBody({ squadronId, blueprint, roles, isPending, error, onSubmit }: Omit<AddMemberDialogProps, 'isOpen' | 'onOpenChange'>) {
  const [picked, setPicked] = useState(roles[0]?.role);
  const role = roles.find((each) => each.role === picked) ?? roles[0];
  if (!role) {
    return null;
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a member to {squadronId}</DialogTitle>
        <DialogDescription>Roles come from its blueprint. Next you get the new member&apos;s crew line.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <span className="text-meta font-medium">Role</span>
        <div role="radiogroup" aria-label="Role" className="flex flex-col gap-2">
          {roles.map((each) => (
            <button
              key={each.role}
              type="button"
              role="radio"
              aria-checked={each.role === role.role}
              data-testid="add-member-role"
              onClick={() => {
                setPicked(each.role);
              }}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-meta aria-checked:border-primary aria-checked:ring-1 aria-checked:ring-primary"
            >
              <span className="rounded-sm bg-muted px-1.5 font-mono">{each.role}</span>
              <span className="font-mono text-muted-foreground">{each.template}</span>
              <span className="ml-auto text-muted-foreground">{each.now} now</span>
            </button>
          ))}
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-meta text-muted-foreground">
        <UserPlus aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
        <span>
          A new ship of the role {role.role}, template <span className="font-mono">{role.template}</span>
          {role.checkInMinutes === undefined ? '' : `, checks in ${checkInText(role.checkInMinutes)}`}. Blueprint {blueprint} has {role.inBlueprint}{' '}
          {role.role}; the squadron then has {role.now + 1}.
        </span>
      </p>
      {error !== undefined && <InlineError variant="field" title="Couldn't add the member" description={`${error} No ship was commissioned.`} />}
      <DialogFooter>
        <DialogClose render={<Button type="button" disabled={isPending} />}>Cancel</DialogClose>
        <Button
          variant="primary"
          isLoading={isPending}
          data-testid="add-member-submit"
          onClick={() => {
            onSubmit(role.role);
          }}
        >
          {isPending ? 'Adding' : 'Add member'}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Adds one member while the squadron sails (docs/design/png/AddMemberDialog.png):
 * the operator picks a role from the blueprint; the dialog says what gets
 * commissioned and how the squadron then differs from its blueprint. On
 * success the CrewLineDialog shows the new member's crew line once.
 */
export function AddMemberDialog(props: AddMemberDialogProps) {
  const { isOpen, onOpenChange, isPending } = props;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isPending) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="add-member-dialog" className={dialogSurface.phoneFullScreen}>
        <AddMemberBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
