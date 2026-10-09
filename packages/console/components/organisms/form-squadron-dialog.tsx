'use client';

import { Info, RotateCw } from 'lucide-react';
import { useId, useState } from 'react';

import type { HarnessOffer } from '../../lib/crew-settings-form';
import { labelErrorSlot, membersOf, missingOf, readyCount, withWorkspaceForAll, workspaceFromItem, workspaceItemsOf, type MemberDraft, type MemberValues } from '../../lib/forming-members';
import type { LabelContext } from '../../lib/labels';
import type { MachineLabelsInput } from '../../lib/machine-labels';
import type { TemplateVersion } from '../../lib/squadrons-schemas';
import { checkInText, memberCount, rolePreviews, type BlueprintChoice } from '../../lib/squadrons-view';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { InlineError } from '../molecules/inline-error';
import { MemberCrewSection } from '../molecules/member-crew-section';

interface FormSquadronDialogProps {
  blueprints: readonly BlueprintChoice[];
  templates: readonly TemplateVersion[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why forming failed, as the squadron manager said it. */
  error?: string;
  /** Forms the squadron; with crew settings, each member's as the form holds them. */
  onSubmit: (blueprint: { repository: string; name: string; version: number }, members?: readonly MemberValues[]) => void;
  /** The blueprint and version picked when the dialog opens, as from a blueprint's page; the latest of the first otherwise. */
  initial?: { key: string; version: number };
  /**
   * With the trierarch plugin connected (#343, S4): each member's crew
   * settings as squadrons merged them from its files, what the machines
   * offer, and the fleet's labels. Step 2 is then one section per member,
   * and forming writes a crew request for each. Without it, step 2 previews
   * the roles and members are crewed by hand with their crew lines.
   */
  crew?: FormCrew;
  /** The version step 2 shows, so its members' crew settings are read. */
  onPicked?: (blueprint: { repository: string; name: string; version: number }) => void;
}

/** What step 2 fills each member from. */
export interface FormCrew {
  state: 'loading' | 'error' | 'ready';
  members: readonly MemberDraft[];
  offers: readonly HarnessOffer[];
  context?: LabelContext;
  machineLabels?: MachineLabelsInput;
  /** Why the members could not be read. */
  error?: string;
  onRetry: () => void;
}

const NONE = '';

/**
 * Step 2 with crew settings (#343, S4): a section per member, prefilled from
 * its files and folded once it needs nothing; Workspace for every member at
 * the top; and below, always in view, how many members are ready, and Form
 * squadron once every one is (the quick accept).
 */
function MemberForm({ drafts, crew, isPending, error, onBack, onSubmit }: { drafts: readonly MemberDraft[]; crew: FormCrew; isPending: boolean; error?: string; onBack: () => void; onSubmit: (members: readonly MemberValues[]) => void }) {
  const allId = useId();
  const [members, setMembers] = useState(() => membersOf(drafts, crew.context));
  const [openSlots, setOpenSlots] = useState(() => new Set(membersOf(drafts, crew.context).filter((member) => missingOf(member).length > 0).map((member) => member.slot)));
  const workspaces = workspaceItemsOf(crew.offers, members);
  const { ready, total } = readyCount(members);
  const isReady = ready === total;
  const errorSlot = error === undefined ? undefined : labelErrorSlot(error, { members, context: crew.context });
  const isWorkspaceMissing = members.some((member) => member.workspace === undefined);

  return (
    <>
      {crew.offers.length === 0 ? (
        <p role="status" className="rounded-md border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg">
          No machine answers with what it offers yet, so there is no workspace to pick. Join a machine under Trierarchs, or wait for its trierarch to report.
        </p>
      ) : null}
      {isWorkspaceMissing && Object.keys(workspaces).length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={allId}>Workspace for every member without one</Label>
          <Select
            items={{ [NONE]: 'Pick a workspace', ...workspaces }}
            value={NONE}
            disabled={isPending}
            onValueChange={(picked) => {
              const workspace = typeof picked === 'string' ? workspaceFromItem(picked) : undefined;
              if (workspace !== undefined) {
                setMembers((current) => withWorkspaceForAll(current, workspace));
              }
            }}
          >
            <SelectTrigger id={allId} data-testid="form-squadron-workspace-all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(workspaces).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="-mx-1 flex max-h-[55vh] flex-col gap-2 overflow-y-auto px-1 max-sm:max-h-none max-sm:flex-1" data-testid="form-squadron-members">
        {members.map((member) => (
          <MemberCrewSection
            key={member.slot}
            member={member}
            offers={crew.offers}
            workspaces={workspaces}
            {...(crew.machineLabels === undefined ? {} : { machineLabels: crew.machineLabels })}
            isOpen={openSlots.has(member.slot) || errorSlot === member.slot}
            onOpenChange={(isOpen) => {
              setOpenSlots((current) => {
                const next = new Set(current);
                if (isOpen) {
                  next.add(member.slot);
                } else {
                  next.delete(member.slot);
                }
                return next;
              });
            }}
            isDisabled={isPending}
            {...(errorSlot === member.slot && error !== undefined ? { error } : {})}
            onChange={(changed) => {
              setMembers((current) => current.map((each) => (each.slot === changed.slot ? changed : each)));
            }}
          />
        ))}
      </div>
      {error !== undefined && errorSlot === undefined ? <InlineError variant="field" title="Couldn’t form the squadron" description={error} /> : null}
      <DialogFooter className="items-center border-t border-border pt-3">
        <span className="mr-auto text-meta tabular-nums" data-testid="form-squadron-ready" aria-live="polite">
          {ready} of {total} {total === 1 ? 'member' : 'members'} ready
        </span>
        <Button type="button" disabled={isPending} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          isLoading={isPending}
          disabled={!isReady}
          data-testid="form-squadron-submit"
          onClick={() => {
            onSubmit(members);
          }}
        >
          {isPending ? 'Forming' : 'Form squadron'}
        </Button>
      </DialogFooter>
    </>
  );
}

function FormSquadronBody({ blueprints, templates, isPending, error, onSubmit, initial, crew, onPicked }: Omit<FormSquadronDialogProps, 'isOpen' | 'onOpenChange'>) {
  const [step, setStep] = useState<1 | 2>(1);
  const [key, setKey] = useState(initial?.key ?? blueprints[0]?.key);
  const choice = blueprints.find((each) => each.key === key) ?? blueprints[0];
  const [version, setVersion] = useState(initial?.version ?? choice?.versions[0]?.version);
  const picked = choice?.versions.find((each) => each.version === version) ?? choice?.versions[0];

  if (!choice || !picked) {
    return null;
  }
  if (step === 1) {
    const versionItems = Object.fromEntries(
      choice.versions.map((each, index) => [String(each.version), `v${String(each.version)}${index === 0 ? ' (latest)' : ''}`]),
    );
    return (
      <>
        <DialogHeader>
          <DialogTitle>Form a squadron</DialogTitle>
          <DialogDescription>Step 1 of 2. Pick a blueprint and the version to form it from.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium">Blueprint</span>
          <div role="radiogroup" aria-label="Blueprint" className="flex flex-col gap-2">
            {blueprints.map((each) => {
              const latest = each.versions[0];
              const isPicked = each.key === choice.key;
              return (
                <button
                  key={each.key}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  data-testid="form-squadron-blueprint"
                  onClick={() => {
                    setKey(each.key);
                    setVersion(each.versions[0]?.version);
                  }}
                  className="flex flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left aria-checked:border-primary aria-checked:ring-1 aria-checked:ring-primary"
                >
                  <span className="text-body font-medium">
                    {each.name} <span className="font-mono text-meta text-muted-foreground">v{latest?.version}, latest</span>
                  </span>
                  <span className="text-meta text-muted-foreground">{latest?.description}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="form-squadron-version">Version</Label>
          <Select
            items={versionItems}
            value={String(picked.version)}
            onValueChange={(value) => {
              setVersion(Number(value));
            }}
          >
            <SelectTrigger id="form-squadron-version" aria-label="Version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(versionItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground">Older versions stay available. Squadrons keep the version they were formed with.</p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            data-testid="form-squadron-preview"
            onClick={() => {
              onPicked?.({ repository: picked.repository, name: picked.name, version: picked.version });
              setStep(2);
            }}
          >
            {crew === undefined ? 'Preview roles' : 'Next: the members'}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const blueprint = { repository: picked.repository, name: picked.name, version: picked.version };
  if (crew !== undefined) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Form a squadron from {picked.name} v{picked.version}
          </DialogTitle>
          <DialogDescription>
            Step 2 of 2. Each member, prefilled from its template and the blueprint. A workspace and every parameter are needed; the rest is optional. Forming commissions {memberCount(picked)} member ships and a flagship, and requests a crew for each member.
          </DialogDescription>
        </DialogHeader>
        {crew.state === 'ready' ? (
          <MemberForm
            drafts={crew.members}
            crew={crew}
            isPending={isPending}
            {...(error === undefined ? {} : { error })}
            onBack={() => {
              setStep(1);
            }}
            onSubmit={(members) => {
              onSubmit(blueprint, members);
            }}
          />
        ) : (
          <>
            {crew.state === 'loading' ? (
              <p className="text-meta text-muted-foreground" data-testid="form-squadron-members-loading">
                Reading each member’s crew settings from its files.
              </p>
            ) : (
              <>
                <InlineError variant="field" title="Couldn’t read the members’ crew settings" description={crew.error ?? 'Try again in a moment.'} />
                <div>
                  <Button size="sm" icon={<RotateCw />} onClick={crew.onRetry}>
                    Try again
                  </Button>
                </div>
              </>
            )}
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setStep(1);
                }}
              >
                Back
              </Button>
              <Button variant="primary" disabled data-testid="form-squadron-submit">
                Form squadron
              </Button>
            </DialogFooter>
          </>
        )}
      </>
    );
  }

  const roles = rolePreviews(picked, templates);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Form a squadron from {picked.name} v{picked.version}
        </DialogTitle>
        <DialogDescription>Step 2 of 2. {memberCount(picked)} member ships and a flagship are commissioned when you confirm.</DialogDescription>
      </DialogHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Check-in</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.role}>
              <TableCell className="font-mono">{role.role}</TableCell>
              <TableCell className="font-mono">{role.template}</TableCell>
              <TableCell>{role.count}</TableCell>
              <TableCell>{role.checkInMinutes === undefined ? 'unknown' : checkInText(role.checkInMinutes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-meta text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
        <span>
          The flagship is named as the squadron, <span className="font-mono">{picked.name}-</span> plus six random characters: the squadron&apos;s address.
          Members are named by role.
        </span>
      </p>
      <p className="text-meta text-muted-foreground">
        Next you get crew lines and a launch note per member. You start each session by hand; the squadron sails once every member is on station.
      </p>
      {error !== undefined && <InlineError variant="field" title="Couldn’t form the squadron" description={error} />}
      <DialogFooter>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => {
            setStep(1);
          }}
        >
          Back
        </Button>
        <Button
          variant="primary"
          isLoading={isPending}
          data-testid="form-squadron-submit"
          onClick={() => {
            onSubmit(blueprint);
          }}
        >
          {isPending ? 'Forming' : 'Form squadron'}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Forming in two steps in one Dialog (docs/design/png/FormSquadronDialog.png):
 * pick a blueprint and version, then preview what gets commissioned, or, with
 * the trierarch plugin, fill each member's crew settings (#343). On
 * success the page opens the new squadron, where each member shows its crew
 * line and launch note once. Phone: full screen.
 */
export function FormSquadronDialog(props: FormSquadronDialogProps) {
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
      <DialogContent size="md" data-testid="form-squadron-dialog" className={dialogSurface.phoneFullScreen}>
        <FormSquadronBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
