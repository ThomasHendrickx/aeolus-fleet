'use client';

import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { useAccess } from '../../../lib/access';
import { refusalOf } from '../../../lib/errors';
import { lazyDialog } from '../../../lib/lazy-dialog';
import { useNow } from '../../../lib/now';
import { useSessionFleetId } from '../../../lib/session-fleet-id';
import { useFleetSealing } from '../../../lib/sealing';
import { useChangeCompanyKey, useChangeRecoveryKey, useTurnOnSealing } from '../hooks/sealing';
import { sealingRefusalOf, type SealingRefusal } from '../services/sealing-refusal';
import type { RecoveryKeyMode } from '../ui/organisms/sealing-keys';
import { SealingPanel } from '../ui/organisms/sealing-panel';

// Dialogs load when first opened, not with the page.
const TurnOnSealingDialog = lazyDialog(
  () => import('../ui/organisms/turn-on-sealing-dialog').then((module) => module.TurnOnSealingDialog),
  (props) => props.isOpen,
);
const ChangeCompanyKeyDialog = lazyDialog(
  () => import('../ui/organisms/change-company-key-dialog').then((module) => module.ChangeCompanyKeyDialog),
  (props) => props.isOpen,
);
const RecoveryKeyDialog = lazyDialog(
  () => import('../ui/organisms/recovery-key-dialog').then((module) => module.RecoveryKeyDialog),
  (props) => props.isOpen,
);

/** A failed key change as the dialog says it; none while it has not failed. */
function refusalIn(error: { message: string } | null): SealingRefusal | undefined {
  return error === null ? undefined : sealingRefusalOf({ refusal: refusalOf(error), message: error.message });
}

type OpenDialog = { kind: 'turnOn' } | { kind: 'companyKey' } | { kind: 'recoveryKey'; mode: RecoveryKeyMode } | undefined;

/**
 * The fleet's sealing, read for every session with fleet:read, with Turn on
 * sealing, Change company key and the recovery key for one holding
 * fleet:keys (decision 0068, N5). Each change answers in its dialog while it
 * runs, closes with a toast when done, and shows the refusal inline with the
 * input kept when not; the page then shows the change in place.
 */
export function Sealing() {
  const access = useAccess();
  const now = useNow();
  const fleetId = useSessionFleetId();
  const sealing = useFleetSealing();
  const turnOn = useTurnOnSealing();
  const changeCompanyKey = useChangeCompanyKey();
  const changeRecoveryKey = useChangeRecoveryKey();
  const [open, setOpen] = useState<OpenDialog>(undefined);

  const canChangeKeys = access.canChangeKeys && fleetId !== undefined;
  const current = sealing.data?.state === 'none' ? undefined : sealing.data;
  const close = (isOpen: boolean) => {
    if (!isOpen) {
      setOpen(undefined);
    }
  };

  return (
    <>
      <SealingPanel
        sealing={sealing.data}
        error={sealing.isError ? sealing.error.message : undefined}
        onRetry={() => {
          void sealing.refetch();
        }}
        now={now}
        {...(canChangeKeys
          ? {
              onTurnOn: () => {
                turnOn.reset();
                setOpen({ kind: 'turnOn' });
              },
              onChangeCompanyKey: () => {
                changeCompanyKey.reset();
                setOpen({ kind: 'companyKey' });
              },
              onChangeRecoveryKey: (mode: RecoveryKeyMode) => {
                changeRecoveryKey.reset();
                setOpen({ kind: 'recoveryKey', mode });
              },
            }
          : {})}
      />
      {canChangeKeys ? (
        <>
          <TurnOnSealingDialog
            isOpen={open?.kind === 'turnOn'}
            onOpenChange={close}
            fleetId={fleetId}
            isPending={turnOn.isPending}
            refusal={refusalIn(turnOn.error)}
            onTurnOn={(input) => {
              turnOn.mutate(input, {
                onSuccess: (turnedOn) => {
                  setOpen(undefined);
                  showToast({
                    title: 'Sealing turned on',
                    description: turnedOn.state === 'sealing' ? 'Payloads stored before are being sealed in the background.' : 'Every payload in this fleet is stored sealed.',
                  });
                },
              });
            }}
          />
          {current === undefined ? null : (
            <>
              <ChangeCompanyKeyDialog
                isOpen={open?.kind === 'companyKey'}
                onOpenChange={close}
                fleetId={fleetId}
                current={current.companyKey}
                isPending={changeCompanyKey.isPending}
                refusal={refusalIn(changeCompanyKey.error)}
                onChange={(input) => {
                  changeCompanyKey.mutate(input, {
                    onSuccess: () => {
                      setOpen(undefined);
                      showToast({
                        title: 'Company key changed',
                        description: 'Every data key moved to the new key.',
                      });
                    },
                  });
                }}
              />
              <RecoveryKeyDialog
                isOpen={open?.kind === 'recoveryKey'}
                onOpenChange={close}
                fleetId={fleetId}
                current={open?.kind === 'recoveryKey' && open.mode === 'set' ? null : current.recoveryKeyFingerprint}
                isPending={changeRecoveryKey.isPending}
                refusal={refusalIn(changeRecoveryKey.error)}
                onChange={(input) => {
                  const isReplacing = current.recoveryKeyFingerprint !== null;
                  changeRecoveryKey.mutate(input, {
                    onSuccess: () => {
                      setOpen(undefined);
                      showToast({
                        title: isReplacing ? 'Recovery key replaced' : 'Recovery key set',
                        description: 'Every data key is wrapped to it. Keep its private half offline.',
                      });
                    },
                  });
                }}
              />
            </>
          )}
        </>
      ) : null}
    </>
  );
}
