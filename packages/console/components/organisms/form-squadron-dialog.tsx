'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

import type { TemplateVersion } from '../../lib/squadrons-api';
import { checkInText, memberCount, rolePreviews, type BlueprintChoice } from '../../lib/squadrons-view';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Label } from '../atoms/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../atoms/table';
import { InlineError } from '../molecules/inline-error';

interface FormSquadronDialogProps {
  blueprints: readonly BlueprintChoice[];
  templates: readonly TemplateVersion[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isPending: boolean;
  /** Why forming failed, as the squadron manager said it. */
  error?: string;
  onSubmit: (blueprint: { repository: string; name: string; version: number }) => void;
  /** The blueprint and version picked when the dialog opens, as from a blueprint's page; the latest of the first otherwise. */
  initial?: { key: string; version: number };
}

function FormSquadronBody({ blueprints, templates, isPending, error, onSubmit, initial }: Omit<FormSquadronDialogProps, 'isOpen' | 'onOpenChange'>) {
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
              setStep(2);
            }}
          >
            Preview roles
          </Button>
        </DialogFooter>
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
            onSubmit({
              repository: picked.repository,
              name: picked.name,
              version: picked.version,
            });
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
 * pick a blueprint and version, then preview what gets commissioned. On
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
