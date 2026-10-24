'use client';

import type { CheckedNetworkRulesFile, NetworkRulesResolution, ShipId } from '@aeolus-fleet/common';
import { CircleCheck, FileUp } from 'lucide-react';
import { useState } from 'react';

import { Combobox } from '../../../../components/atoms/combobox';
import { Label } from '../../../../components/atoms/label';
import { Textarea } from '../../../../components/atoms/textarea';
import { InlineError } from '../../../../components/molecules/inline-error';
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, dialogSurface, DialogTitle } from '@aeolus-fleet/common/header';
import { differenceKeyOf, isEveryDifferenceResolved, resolutionOf, ruleLinesOf, type ResolutionChoice } from '../../services/rules-file';
import { NetworkRulesDifferenceField } from '../molecules/network-rules-difference-field';

export interface ImportNetworkRulesDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The fleet's answer to the last check of the file as it is now; none before a check or after the file changed. */
  checked?: CheckedNetworkRulesFile;
  isChecking: boolean;
  /** Why the last check failed, as the fleet says it: each break of the file. */
  checkError?: string;
  onCheck: (file: string) => void;
  /** The file changed: the last check no longer holds. */
  onFileChange: () => void;
  /** The active ships that match the name typed, argo first, as the container reads them: the definers and the ships a pick may name. */
  ships: readonly { id: ShipId; name: string; isOperator: boolean }[];
  /** Each change of a ship name typed, so the container reads the ships that match. */
  onShipQueryChange?: (query: string) => void;
  isImporting: boolean;
  /** Why the last import failed, as the fleet says it: nothing was written. */
  importError?: string;
  onImport: (input: { file: string; definerShipId?: ShipId; resolutions: NetworkRulesResolution[] }) => void;
}

const STEPS = ['Attach or paste', 'Check', 'Overview', 'Import'] as const;

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-meta" aria-label="Import steps" data-testid="network-import-steps">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={index === current ? 'step' : undefined} className={index === current ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
          {index + 1}. {step}
        </li>
      ))}
    </ol>
  );
}

/** The open dialog's steps: the file, its check and overview, then the confirm. Starts empty each time it opens. */
function ImportSteps(props: Omit<ImportNetworkRulesDialogProps, 'isOpen' | 'onOpenChange'>) {
  const { checked, isChecking, checkError, onCheck, onFileChange, ships, onShipQueryChange, isImporting, importError, onImport } = props;
  const [file, setFile] = useState('');
  const [choices, setChoices] = useState<ResolutionChoice[]>([]);
  const argo = ships.find((ship) => ship.isOperator);
  const [definerId, setDefinerId] = useState<ShipId | undefined>(argo?.id);
  const [isConfirming, setIsConfirming] = useState(false);
  const isBusy = isChecking || isImporting;
  const changeFile = (text: string) => {
    setFile(text);
    setChoices([]);
    setIsConfirming(false);
    onFileChange();
  };

  if (checked === undefined) {
    return (
      <>
        <Steps current={isChecking ? 1 : 0} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="network-import-attach">Attach the file</Label>
          <input
            id="network-import-attach"
            type="file"
            accept="application/json,.json"
            disabled={isBusy}
            data-testid="network-import-attach"
            className="text-body file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5"
            onChange={(event) => {
              const attached = event.target.files?.[0];
              if (attached !== undefined) {
                void attached.text().then(changeFile);
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="network-import-paste">Or paste it</Label>
          <Textarea
            id="network-import-paste"
            isMono
            rows={8}
            value={file}
            disabled={isBusy}
            placeholder='{ "format": "aeolus.network-rules", ... }'
            data-testid="network-import-paste"
            onChange={(event) => {
              changeFile(event.target.value);
            }}
          />
        </div>
        {checkError === undefined ? null : <InlineError title="The file doesn’t check" description={`${checkError}. Nothing changed: fix the file and check it again.`} />}
        <DialogFooter>
          <DialogClose render={<Button type="button" disabled={isBusy} />}>Cancel</DialogClose>
          <Button
            variant="primary"
            isLoading={isChecking}
            disabled={file.trim() === '' || isBusy}
            data-testid="network-import-check"
            onClick={() => {
              onCheck(file);
            }}
          >
            {isChecking ? 'Checking…' : 'Check file'}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const { file: read, newLabels, differences } = checked;
  const rules = read.rules ?? [];
  const isResolved = isEveryDifferenceResolved(differences, choices);
  const definer = ships.find((ship) => ship.id === definerId);
  const canImport = isResolved && (newLabels.length === 0 || definer !== undefined) && !isBusy;
  const resolutions = choices.flatMap((choice) => resolutionOf(choice) ?? []);
  const doImport = () => {
    onImport({ file, resolutions, ...(newLabels.length === 0 || definer === undefined || definer.isOperator ? {} : { definerShipId: definer.id }) });
  };

  if (isConfirming) {
    return (
      <>
        <Steps current={3} />
        <DialogHeader>
          <DialogTitle>Import into the draft?</DialogTitle>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body" data-testid="network-import-consequences">
          <li>{read.rules === null ? 'The draft becomes all-to-all, every ship reaching every ship.' : choices.some((choice) => choice.way === 'dropRules') ? `The draft is replaced by the file’s ${String(rules.length)} rules, less the ones you chose to drop.` : `The draft is replaced by the file’s ${String(rules.length)} rules.`}</li>
          {newLabels.length === 0 ? null : (
            <li>
              {newLabels.join(', ')} {newLabels.length === 1 ? 'is' : 'are'} defined for {definer?.name ?? 'argo'}.
            </li>
          )}
          <li>Nothing is in force until you apply the draft.</li>
        </ul>
        {importError === undefined ? null : (
          <InlineError
            variant="section"
            title="Couldn’t import the file"
            description={`${importError}. Nothing was written.`}
            onRetry={() => {
              setIsConfirming(false);
              onCheck(file);
            }}
          />
        )}
        <DialogFooter>
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => {
              setIsConfirming(false);
            }}
          >
            Back
          </Button>
          <Button variant="primary" isLoading={isImporting} disabled={isBusy} data-testid="network-import-confirm" onClick={doImport}>
            {isImporting ? 'Importing…' : 'Import into the draft'}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <Steps current={2} />
      <p className="flex items-start gap-2 text-body" role="status" data-testid="network-import-checked">
        <CircleCheck aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-tone-ok-fg" />
        <span>
          The file checks: {read.rules === null ? 'all-to-all, no rules' : `${String(rules.length)} rules`} and {read.labels.length} labels, from {read.fleet.name} at rules version {read.rulesVersion}, exported{' '}
          {new Date(read.exportedAt).toLocaleString()}.
        </span>
      </p>
      {differences.length === 0 ? null : (
        <section aria-labelledby="network-import-differences" className="flex flex-col gap-2" data-testid="network-import-differences">
          <h3 id="network-import-differences" className="text-body font-semibold">
            {differences.length === 1 ? '1 difference to resolve' : `${String(differences.length)} differences to resolve`}
          </h3>
          {differences.map((difference) => {
            const key = differenceKeyOf(difference);
            return (
              <NetworkRulesDifferenceField
                key={key}
                difference={difference}
                choice={choices.find((choice) => differenceKeyOf(choice.difference) === key)}
                ships={ships}
                onShipQueryChange={onShipQueryChange}
                isDisabled={isBusy}
                onChange={(choice) => {
                  setChoices([...choices.filter((held) => differenceKeyOf(held.difference) !== key), choice]);
                }}
              />
            );
          })}
        </section>
      )}
      {newLabels.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="network-import-definer">
            Define {newLabels.join(', ')} for
          </Label>
          <Combobox
            id="network-import-definer"
            options={ships.map((ship) => ({ value: ship.id, label: ship.name }))}
            value={definerId ?? null}
            onValueChange={(shipId) => {
              setDefinerId(ships.find((ship) => ship.id === shipId)?.id);
            }}
            onQueryChange={onShipQueryChange}
            groupLabel="Active ships"
            placeholder="Type a ship name"
            data-testid="network-import-definer"
          />
          <p className="text-meta text-muted-foreground">argo never retires, so its labels never go. Another ship must be within your manage reach.</p>
        </div>
      )}
      <section aria-labelledby="network-import-rules" className="flex flex-col gap-1.5">
        <h3 id="network-import-rules" className="text-body font-semibold">
          Rules in the file
        </h3>
        {rules.length === 0 ? (
          <p className="text-meta text-muted-foreground">{read.rules === null ? 'None: all-to-all.' : 'None: only the built-in and declared rules.'}</p>
        ) : (
          <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto font-mono text-code" data-testid="network-import-rules">
            {ruleLinesOf(rules).map(({ place, line }) => (
              <li key={place}>{line}</li>
            ))}
          </ol>
        )}
      </section>
      <DialogFooter className="items-center">
        <span className="mr-auto text-meta text-muted-foreground">{isResolved ? null : 'Resolve every difference to import.'}</span>
        <Button
          type="button"
          disabled={isBusy}
          onClick={() => {
            changeFile(file);
          }}
        >
          Back
        </Button>
        <Button
          variant="primary"
          disabled={!canImport}
          data-testid="network-import-open-confirm"
          onClick={() => {
            setIsConfirming(true);
          }}
        >
          Import…
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Import of the network rules (design network-io, section 5), four steps:
 * attach or paste the file; the fleet checks it, naming each break; the
 * overview shows every rule with the differences on top, each resolved by a
 * way it offers, and the definer of the labels import creates, argo
 * preselected; Import confirms, and the rules land in the draft, which apply
 * puts in force as any draft. The fleet reads the file, never the browser.
 * Desktop: a dialog; phone: full screen. Props only.
 */
export function ImportNetworkRulesDialog(props: ImportNetworkRulesDialogProps) {
  const { isOpen, onOpenChange, isChecking, isImporting } = props;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isNowOpen) => {
        if (!isChecking && !isImporting) {
          onOpenChange(isNowOpen);
        }
      }}
    >
      <DialogContent size="md" data-testid="network-import-dialog" className={dialogSurface.phoneFullScreen}>
        <DialogHeader>
          <DialogTitle>
            <FileUp aria-hidden className="mr-2 inline size-(--size-icon-sm)" />
            Import network rules
          </DialogTitle>
          <DialogDescription>Rules exported from this fleet or another land in the draft; nothing is in force until you apply it.</DialogDescription>
        </DialogHeader>
        {isOpen ? <ImportSteps {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
