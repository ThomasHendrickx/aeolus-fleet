'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/atoms/button';
import { ComposeMessage } from '../../components/organisms/compose-message';
import { ConsoleCommands } from '../../components/organisms/console-commands';
import { ConsoleGuide } from '../../components/organisms/console-guide';
import { ConsoleNotices } from '../../components/organisms/console-notices';
import type { ValuesBusy } from '../../components/organisms/label-values-dialog';
import { LabelsTable } from '../../components/organisms/labels-table';
import { DetailLayout } from '../../components/templates/detail-layout';
import { lazyDialog } from '../../lib/lazy-dialog';
import { useAccess } from '../../lib/access';
import { useAccountMenu } from '../../lib/account';
import { useChangeLabelValues, useDefineLabel, useDeleteLabel, useFleetLabels, useLabelContext } from '../../lib/fleet';
import { useOpenInboxCount } from '../../lib/inbox';
import { activeShipCount, labelRowsOf } from '../../lib/labels';
import { useLiveFleet } from '../../lib/live-fleet';
import { useAttentionCount, useNeedsAttention } from '../../lib/needs-attention';
import { useNow } from '../../lib/now';
import { usePluginNav } from '../../lib/plugin-nav';
import { useSignInWhenSessionEnds } from '../../lib/session';

// Dialogs load when first opened, not with the page.
const DefineLabelDialog = lazyDialog(() => import('../../components/organisms/define-label-dialog').then((module) => module.DefineLabelDialog), (props) => props.isOpen);
const DeleteLabelDialog = lazyDialog(() => import('../../components/organisms/delete-label-dialog').then((module) => module.DeleteLabelDialog), (props) => props.row !== undefined);
const LabelValuesDialog = lazyDialog(() => import('../../components/organisms/label-values-dialog').then((module) => module.LabelValuesDialog), (props) => props.row !== undefined);

const DESCRIPTION = 'An owned vocabulary for selecting ships: filter the fleet with them, and crew requests use them to pick a machine. Only a label’s owner assigns it.';

/**
 * Labels (#102; canvas Labels, Q1): Fleet overview › Labels. Every label of
 * the fleet with its values, owner and ships; Define a label, and your labels'
 * values changed or the label deleted. A viewer reads it.
 */
export default function LabelsPage() {
  const now = useNow();
  const accountMenu = useAccountMenu(now);
  const inboxCount = useOpenInboxCount();
  const attention = useNeedsAttention();
  const attentionCount = useAttentionCount();
  const liveFleet = useLiveFleet();
  const access = useAccess();
  const pluginNav = usePluginNav();
  const labels = useFleetLabels();
  const context = useLabelContext();
  const define = useDefineLabel();
  const change = useChangeLabelValues();
  const remove = useDeleteLabel();
  const [isDefining, setIsDefining] = useState(false);
  const [valuesOf, setValuesOf] = useState<string | undefined>(undefined);
  const [valuesBusy, setValuesBusy] = useState<ValuesBusy>(undefined);
  const [valuesError, setValuesError] = useState<{ valueId?: string; value: string; message: string } | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const [isComposing, setIsComposing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  useSignInWhenSessionEnds([attention.error, liveFleet.error, labels.error]);

  const rows = context === undefined ? undefined : labelRowsOf(context);
  const canDefine = access.canDefineLabels;
  const valuesRow = rows?.find((row) => row.labelId === valuesOf);
  const deletingRow = rows?.find((row) => row.labelId === deleting);

  /** Gives the open label every value it has from now on: one added or one removed, at once. */
  const changeValues = (next: { values: string[]; busy: NonNullable<ValuesBusy>; refused: { valueId?: string; value: string } }) => {
    if (valuesRow === undefined) {
      return;
    }
    setValuesBusy(next.busy);
    setValuesError(undefined);
    change.mutate(
      { labelId: valuesRow.labelId, values: next.values },
      {
        onError: (error) => {
          setValuesError({ ...next.refused, message: error.message });
        },
        onSettled: () => {
          setValuesBusy(undefined);
        },
      },
    );
  };

  return (
    <DetailLayout
      title="Labels"
      parents={[{ href: '/', label: 'Fleet overview' }]}
      live={liveFleet.live}
      nav={{ active: 'overview', inboxCount, attentionCount, ...pluginNav }}
      onCompose={
        access.canSend
          ? () => {
              setIsComposing(true);
            }
          : undefined
      }
      onSearch={() => {
        setIsSearching(true);
      }}
      account={accountMenu}
      banner={
        <>
          <ConsoleNotices />
          <ConsoleGuide />
        </>
      }
      header={
        <div className="flex flex-wrap items-start justify-between gap-4 max-sm:gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-title font-semibold tracking-tight max-sm:text-title-touch">Labels</h1>
            <p className="text-meta text-muted-foreground max-sm:text-body-touch">{DESCRIPTION}</p>
          </div>
          {canDefine && rows !== undefined && rows.length > 0 ? (
            <Button
              variant="primary"
              icon={<Plus />}
              className="max-sm:w-full"
              data-testid="labels-define"
              onClick={() => {
                define.reset();
                setIsDefining(true);
              }}
            >
              Define a label
            </Button>
          ) : null}
        </div>
      }
    >
      <LabelsTable
        rows={rows}
        shipTotal={context === undefined ? 0 : activeShipCount(context)}
        error={labels.isError ? labels.error.message : undefined}
        onRetry={() => {
          void labels.refetch();
        }}
        onDefine={
          canDefine
            ? () => {
                define.reset();
                setIsDefining(true);
              }
            : undefined
        }
        onChangeValues={
          canDefine
            ? (row) => {
                setValuesError(undefined);
                setValuesOf(row.labelId);
              }
            : undefined
        }
        onDelete={
          canDefine
            ? (row) => {
                remove.reset();
                setDeleting(row.labelId);
              }
            : undefined
        }
      />
      {canDefine ? (
        <>
          <DefineLabelDialog
            isOpen={isDefining}
            onOpenChange={setIsDefining}
            isPending={define.isPending}
            error={define.error?.message}
            onSubmit={(label) => {
              define.mutate(label, {
                onSuccess: () => {
                  setIsDefining(false);
                },
              });
            }}
          />
          <LabelValuesDialog
            row={valuesRow}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                setValuesOf(undefined);
              }
            }}
            busy={valuesBusy}
            error={valuesError}
            onAdd={(value) => {
              changeValues({ values: [...(valuesRow?.values.map((each) => each.value) ?? []), value], busy: { action: 'add', value }, refused: { value } });
            }}
            onRemove={(valueId) => {
              const removed = valuesRow?.values.find((each) => each.valueId === valueId);
              changeValues({
                values: valuesRow?.values.filter((each) => each.valueId !== valueId).map((each) => each.value) ?? [],
                busy: { action: 'remove', valueId },
                refused: { valueId, value: removed?.value ?? '' },
              });
            }}
          />
          <DeleteLabelDialog
            row={deletingRow}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                setDeleting(undefined);
              }
            }}
            isPending={remove.isPending}
            error={remove.error?.message}
            onDelete={(labelId) => {
              remove.mutate(
                { labelId },
                {
                  onSuccess: () => {
                    setDeleting(undefined);
                  },
                },
              );
            }}
          />
        </>
      ) : null}
      <ComposeMessage isOpen={isComposing} onOpenChange={setIsComposing} />
      <ConsoleCommands
        isOpen={isSearching}
        onOpenChange={setIsSearching}
        onCompose={() => {
          setIsComposing(true);
        }}
      />
    </DetailLayout>
  );
}
