import { useId, type ReactNode } from 'react';
import { useController, useForm } from 'react-hook-form';
import { InlineError, Input, Label } from '@aeolus-fleet/ui';
import { RadioGroup, RadioGroupItem } from '../../../../components/atoms/radio-group';
import type { RuleSetRepository } from '../../services/guard-configuration';
import { ConfigurationFormDialog } from './configuration-form-dialog';

type RepositoryFields = RuleSetRepository & { readToken: string };

/** New read tokens live in the password field for the lifetime of the form. */
export function AddRuleSetRepositoryDialog({ isPending, isDisabled, notice, onClose, onAdd }: {
  isPending: boolean;
  isDisabled: boolean;
  notice?: ReactNode;
  onClose: () => void;
  onAdd: (repository: RuleSetRepository, readToken: string) => void;
}) {
  const id = useId();
  const { control, register, handleSubmit, formState: { errors } } = useForm<RepositoryFields>({
    defaultValues: { repository: '', folder: '', access: 'public', readToken: '' },
    shouldUnregister: true,
  });
  const { field: access } = useController({ name: 'access', control });

  return (
    <ConfigurationFormDialog
      title="Add repository"
      description="Connect the GitHub repository and folder that hold the rule set files."
      action="Add repository"
      isDisabled={isDisabled}
      isPending={isPending}
      onClose={onClose}
      onSubmit={() => {
        void handleSubmit(({ repository, folder, access: selectedAccess, readToken }) => {
          onAdd({ repository: repository.trim(), folder: folder.trim(), access: selectedAccess }, selectedAccess === 'private' ? readToken : '');
        })();
      }}
      testIdPrefix="rule-sets"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-repository`}>Repository</Label>
        <Input
          id={`${id}-repository`}
          data-testid="rule-sets-repository"
          aria-invalid={errors.repository !== undefined || undefined}
          aria-describedby={`${id}-repository-hint${errors.repository ? ` ${id}-repository-error` : ''}`}
          autoComplete="off"
          autoCapitalize="none"
          isMono
          disabled={isPending}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          {...register('repository', {
            validate: (value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim()) || 'Enter a GitHub repository in owner/name form.',
          })}
        />
        <p id={`${id}-repository-hint`} className="text-meta text-muted-foreground">owner/name on GitHub.</p>
        {errors.repository?.message ? <InlineError variant="field" id={`${id}-repository-error`} title={errors.repository.message} /> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-folder`}>Folder <span className="font-normal text-muted-foreground">optional</span></Label>
        <Input
          id={`${id}-folder`}
          data-testid="rule-sets-folder"
          aria-describedby={`${id}-folder-hint`}
          autoComplete="off"
          isMono
          disabled={isPending}
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          {...register('folder')}
        />
        <p id={`${id}-folder-hint`} className="text-meta text-muted-foreground">The repository’s root when empty.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span id={`${id}-access`} className="text-body font-medium">Access</span>
        <RadioGroup
          aria-labelledby={`${id}-access`}
          name={access.name}
          value={access.value}
          disabled={isPending}
          onValueChange={access.onChange}
          onBlur={access.onBlur}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-public`} aria-labelledby={`${id}-public-label`} value="public" />
            <Label id={`${id}-public-label`} htmlFor={`${id}-public`} className="font-normal">Public</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-private`} aria-labelledby={`${id}-private-label`} value="private" data-testid="rule-sets-private" />
            <Label id={`${id}-private-label`} htmlFor={`${id}-private`} className="font-normal">Private</Label>
          </div>
        </RadioGroup>
      </div>
      {access.value === 'private' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-token`}>Read token</Label>
          <Input
            id={`${id}-token`}
            data-testid="rule-sets-read-token"
            type="password"
            autoComplete="off"
            aria-invalid={errors.readToken !== undefined || undefined}
            aria-describedby={`${id}-token-hint${errors.readToken ? ` ${id}-token-error` : ''}`}
            disabled={isPending}
            className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            {...register('readToken', { required: 'Enter the read token for this private repository.' })}
          />
          <p id={`${id}-token-hint`} className="text-meta text-muted-foreground">Kept by the plugin on its server. The value is shown only as you enter it.</p>
          {errors.readToken?.message ? <InlineError variant="field" id={`${id}-token-error`} title={errors.readToken.message} /> : null}
        </div>
      ) : null}
      {notice}
    </ConfigurationFormDialog>
  );
}
