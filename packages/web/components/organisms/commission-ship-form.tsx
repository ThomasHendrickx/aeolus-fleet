'use client';

import { commissionShipInputSchema } from '@aeolus-fleet/common';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { useCommissionShip } from '../../lib/fleet';
import { StartingPromptBlock } from '../molecules/starting-prompt-block';

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
    <section aria-labelledby="commission-heading">
      <h2 id="commission-heading">Commission a ship</h2>
      <form
        noValidate
        data-testid="commission-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <p>
          <label htmlFor="commission-name">Name</label>
          <input
            id="commission-name"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'commission-name-error' : undefined}
            {...register('name')}
          />
          {errors.name ? <span id="commission-name-error">{errors.name.message}</span> : null}
        </p>
        <p>
          <label htmlFor="commission-type">Type</label>
          <input
            id="commission-type"
            autoComplete="off"
            aria-invalid={errors.type ? true : undefined}
            aria-describedby={errors.type ? 'commission-type-error' : undefined}
            {...register('type')}
          />
          {errors.type ? <span id="commission-type-error">{errors.type.message}</span> : null}
        </p>
        <p>
          <label htmlFor="commission-note">Note (optional)</label>
          <textarea
            id="commission-note"
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'commission-note-error' : undefined}
            {...register('note')}
          />
          {errors.note ? <span id="commission-note-error">{errors.note.message}</span> : null}
        </p>
        <button type="submit" disabled={commission.isPending}>
          Commission
        </button>
      </form>
      {commission.isError ? <p role="alert">Not commissioned: {commission.error.message}</p> : null}
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
