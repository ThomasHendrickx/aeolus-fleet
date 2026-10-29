import { KeyRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, classNames } from '@aeolus-fleet/common/header';
import { Badge } from '../../../../components/atoms/badge';
import { CopyButton } from '../../../../components/atoms/copy-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/atoms/table';
import { StatusBadge } from '../../../../components/molecules/status-badge';
import { fullDateTime, shortDateTime, sinceTime } from '../../../../lib/relative-time';
import { availabilitySince, dataKeyAge, keyUnavailableReasonWords, newestFirst, shortCompanyKey, shortened, stateSince, type Sealing } from '../../services/sealing-view';
import { SealingProgress } from '../molecules/sealing-progress';

/** Which recovery key dialog opens: replacing the one set, or setting the first. */
export type RecoveryKeyMode = 'replace' | 'set';

interface SealingKeysProps {
  sealing: Sealing;
  now: Date;
  /** Change company key… and the recovery key's button: offered with fleet:keys. */
  onChangeCompanyKey?: () => void;
  onChangeRecoveryKey?: (mode: RecoveryKeyMode) => void;
}

const DATA_KEYS_NOTE = 'A new one every 30 days. Older ones stay to open older payloads.';

/** One row of the Keys card: its name, what it holds, and its action on the right; stacked on phone. */
function KeyRow({ name, children, action, className }: { name: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={classNames('flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-2', className)}>
      <dt className="w-40 shrink-0 text-meta text-muted-foreground">{name}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</dd>
      {action}
    </div>
  );
}

function KeyAction({ label, testId, onClick }: { label: string; testId: string; onClick: () => void }) {
  return (
    <Button size="sm" className="shrink-0 max-sm:h-(--size-control-touch) max-sm:w-full" data-testid={testId} onClick={onClick}>
      {label}
    </Button>
  );
}

function Availability({ keyAvailability, now }: Pick<Sealing, 'keyAvailability'> & { now: Date }) {
  return (
    <>
      <StatusBadge status={keyAvailability.isAvailable ? 'reachable' : 'notReachable'} />
      <span className="text-meta text-muted-foreground tabular-nums">{availabilitySince(keyAvailability, now)}</span>
    </>
  );
}

/** The company cut its key off (B11): what that stops, and that nothing waiting is lost. */
function KeyNotReachable({ keyAvailability, now }: { keyAvailability: Extract<Sealing['keyAvailability'], { isAvailable: false }>; now: Date }) {
  return (
    <div role="status" data-testid="sealing-key-not-reachable" className="flex gap-2 rounded-lg border border-tone-attention-border bg-tone-attention-bg p-3 text-tone-attention-fg">
      <KeyRound aria-hidden className="mt-0.5 size-(--size-icon) shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">Company key not reachable</p>
        <p className="text-meta text-foreground">
          Since {sinceTime(new Date(keyAvailability.since), now)} your KMS answers: {keyUnavailableReasonWords(keyAvailability.reason)}. Sends and receives are refused until it is back. Nothing
          waiting is lost.
        </p>
      </div>
    </div>
  );
}

function DataKeyId({ id, isCurrent }: { id: string; isCurrent: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-id" title={id}>
        {shortened(id)}
      </span>
      <CopyButton value={id} label="Copy data key id" size="xs" />
      {isCurrent ? <Badge variant="kind">current</Badge> : null}
    </span>
  );
}

/**
 * A sealed fleet's keys (sealing page mockup, screen 1): where sealing
 * stands and since when, the sealing pass's progress while it seals what came
 * before, the company key by reference with whether it is reachable, the
 * recovery key by fingerprint or none, and the data keys newest first with
 * their ages. With the key cut off, a notice says so on top. Never a key.
 * The buttons to change keys show only with fleet:keys; without it, a line
 * says what changing them takes.
 */
export function SealingKeys({ sealing, now, onChangeCompanyKey, onChangeRecoveryKey }: SealingKeysProps) {
  const { keyAvailability, companyKey, recoveryKeyFingerprint, progress } = sealing;
  const canChangeKeys = onChangeCompanyKey !== undefined && onChangeRecoveryKey !== undefined;
  const dataKeys = newestFirst(sealing.dataKeys);

  return (
    <div className="flex flex-col gap-6" data-testid="sealing-keys">
      {keyAvailability.isAvailable ? null : <KeyNotReachable keyAvailability={keyAvailability} now={now} />}
      <section className="flex flex-col gap-2" aria-labelledby="sealing-keys-heading">
        <h2 id="sealing-keys-heading" className="text-body font-medium max-sm:sr-only">
          Keys
        </h2>
        <dl className="rounded-lg border border-border bg-card">
          <KeyRow name="State">
            <StatusBadge status={sealing.state} />
            <span className="text-meta text-muted-foreground tabular-nums" data-testid="sealing-state-since">
              {stateSince(sealing, now)}
            </span>
          </KeyRow>
          {progress === null ? null : (
            <KeyRow name="Sealing what came before">
              <SealingProgress progress={progress} />
            </KeyRow>
          )}
          <KeyRow name="Company key" action={onChangeCompanyKey === undefined ? undefined : <KeyAction label="Change company key…" testId="sealing-change-company-key" onClick={onChangeCompanyKey} />}>
            <span className="min-w-0 truncate font-mono text-id" title={companyKey} data-testid="sealing-company-key">
              {shortCompanyKey(companyKey)}
            </span>
            <CopyButton value={companyKey} label="Copy key reference" size="xs" />
            <span className="text-meta text-muted-foreground max-sm:hidden">AWS KMS</span>
            <span className="flex w-full flex-wrap items-center gap-2 sm:hidden">
              <Availability keyAvailability={keyAvailability} now={now} />
            </span>
          </KeyRow>
          <KeyRow name="Availability" className="max-sm:hidden">
            <Availability keyAvailability={keyAvailability} now={now} />
          </KeyRow>
          <KeyRow
            name="Recovery key"
            action={
              onChangeRecoveryKey === undefined ? undefined : recoveryKeyFingerprint === null ? (
                <KeyAction
                  label="Set recovery key…"
                  testId="sealing-set-recovery-key"
                  onClick={() => {
                    onChangeRecoveryKey('set');
                  }}
                />
              ) : (
                <KeyAction
                  label="Replace recovery key…"
                  testId="sealing-replace-recovery-key"
                  onClick={() => {
                    onChangeRecoveryKey('replace');
                  }}
                />
              )
            }
          >
            {recoveryKeyFingerprint === null ? (
              <span className="text-meta text-muted-foreground">None. Without one, recovery is your KMS’s own.</span>
            ) : (
              <>
                <span className="font-mono text-id" title={recoveryKeyFingerprint} data-testid="sealing-recovery-key">
                  {shortened(recoveryKeyFingerprint)}
                </span>
                <CopyButton value={recoveryKeyFingerprint} label="Copy fingerprint" size="xs" />
                <span className="text-meta text-muted-foreground max-sm:hidden">Keep its private half offline.</span>
              </>
            )}
          </KeyRow>
        </dl>
        {canChangeKeys ? null : (
          <p className="text-meta text-muted-foreground">
            Changing keys takes the scope <span className="font-mono">fleet:keys</span>.
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="sealing-data-keys-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sealing-data-keys-heading" className="text-body font-medium">
            Data keys
          </h2>
          <p className="text-meta text-muted-foreground max-sm:hidden">{DATA_KEYS_NOTE}</p>
        </div>
        <div className="max-sm:hidden">
          <Table aria-label="Data keys">
            <TableHeader>
              <TableRow>
                <TableHead>Data key</TableHead>
                <TableHead className="w-50">Created</TableHead>
                <TableHead className="w-35">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataKeys.map((dataKey) => (
                <TableRow key={dataKey.id} data-testid="sealing-data-key">
                  <TableCell>
                    <DataKeyId id={dataKey.id} isCurrent={dataKey.isCurrent} />
                  </TableCell>
                  <TableCell className="text-meta text-muted-foreground tabular-nums">
                    <time dateTime={dataKey.createdAt} title={fullDateTime(new Date(dataKey.createdAt))}>
                      {shortDateTime(new Date(dataKey.createdAt))}
                    </time>
                  </TableCell>
                  <TableCell className="text-meta text-muted-foreground tabular-nums">{dataKeyAge(dataKey.createdAt, now)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="rounded-lg border border-border bg-card sm:hidden" aria-label="Data keys">
          {dataKeys.map((dataKey) => (
            <li key={dataKey.id} className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0">
              <DataKeyId id={dataKey.id} isCurrent={dataKey.isCurrent} />
              <span className="text-meta text-muted-foreground tabular-nums">
                {shortDateTime(new Date(dataKey.createdAt))} · {dataKeyAge(dataKey.createdAt, now)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-meta text-muted-foreground sm:hidden">{DATA_KEYS_NOTE}</p>
      </section>
    </div>
  );
}
