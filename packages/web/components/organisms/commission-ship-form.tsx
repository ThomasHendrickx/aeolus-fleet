'use client';

import { commissionShipInputSchema } from '@aeolus-fleet/common';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { useCommissionShip } from '../../lib/fleet';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';
import { Textarea } from '../atoms/textarea';
import { StartingPromptBlock } from '../molecules/starting-prompt-block';

const FIELD = 'flex flex-col gap-1.5';
const FIELD_ERROR = 'text-meta text-destructive-text';

/**
 * Commission a ship: name, type and an optional note, checked with the same
 * schema the server uses. On success the ship's first starting prompt is shown
 * once; on failure the input stays so the operator can fix it.
 */
export function CommissionShipForm() {
  const commission = useCommissionShip();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(commissionShipInputSchema),
    defaultValues: { name: '', type: '', note: '' },
  });

  const submit = handleSubmit((input) => {
    commission.mutate(input, {
      onSuccess: () => {
        reset();
      },
    });
  });

  return (
    <section aria-labelledby="commission-heading" className="flex flex-col gap-3">
      <h2 id="commission-heading" className="text-section font-semibold">
        Commission a ship
      </h2>
      <form
        noValidate
        data-testid="commission-form"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={FIELD}>
            <Label htmlFor="commission-name">Name</Label>
            <Input
              id="commission-name"
              isMono
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'commission-name-error' : undefined}
              {...register('name')}
            />
            {errors.name ? (
              <span id="commission-name-error" className={FIELD_ERROR}>
                {errors.name.message}
              </span>
            ) : null}
          </div>
          <div className={FIELD}>
            <Label htmlFor="commission-type">Type</Label>
            <Input
              id="commission-type"
              isMono
              autoComplete="off"
              aria-invalid={errors.type ? true : undefined}
              aria-describedby={errors.type ? 'commission-type-error' : undefined}
              {...register('type')}
            />
            {errors.type ? (
              <span id="commission-type-error" className={FIELD_ERROR}>
                {errors.type.message}
              </span>
            ) : null}
          </div>
        </div>
        <div className={FIELD}>
          <Label htmlFor="commission-note">Note (optional)</Label>
          <Textarea
            id="commission-note"
            rows={3}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'commission-note-error' : undefined}
            {...register('note')}
          />
          {errors.note ? (
            <span id="commission-note-error" className={FIELD_ERROR}>
              {errors.note.message}
            </span>
          ) : null}
        </div>
        {commission.isError ? (
          <div className="flex gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-tone-attention-fg">
            <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
            <p role="alert">Not commissioned: {commission.error.message}</p>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" icon={<Plus />} isLoading={commission.isPending}>
            Commission
          </Button>
        </div>
      </form>
      {commission.data ? (
        <StartingPromptBlock
          shipName={commission.variables.name}
          prompt={commission.data.prompt}
          onDone={() => {
            commission.reset();
          }}
        />
      ) : null}
    </section>
  );
}
