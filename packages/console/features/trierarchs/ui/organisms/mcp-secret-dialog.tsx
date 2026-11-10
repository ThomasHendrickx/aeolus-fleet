import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { Input, Label } from '@aeolus-fleet/ui';
import { McpFormShell } from './mcp-form-shell';
import { McpSaveErrorNotice, type McpSaveError } from './mcp-save-error';

/** A replacement value is write-only and exists only for this open form. */
export function McpSecretDialog({
  name,
  usedBy,
  isPending,
  error,
  isReading,
  onClose,
  onSave,
  onReadAgain,
}: {
  name: string;
  usedBy: readonly string[];
  isPending: boolean;
  error?: McpSaveError;
  isReading?: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
  onReadAgain: () => void;
}) {
  const id = useId();
  const { register, handleSubmit } = useForm<{ value: string }>({ defaultValues: { value: '' } });
  return (
    <McpFormShell
      size="sm"
      title={`Replace ${name}’s value`}
      description={`${usedBy.length === 0 ? 'No server uses it.' : `Used by ${usedBy.join(', ')}.`} The old value is not shown and cannot be read back. Sessions use the new one once their machine applies the change.`}
      isPending={isPending}
      isDisabled={error?.kind === 'no-answer' || error?.kind === 'read-failed' || isReading}
      action={error?.kind === 'stale' ? 'Save again' : 'Save value'}
      onClose={onClose}
      onSubmit={() => {
        void handleSubmit(({ value }) => {
          onSave(value);
        })();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>New value</Label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          disabled={isPending}
          data-testid="mcp-value"
          className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
          {...register('value')}
        />
        <p className="text-meta text-muted-foreground">Write-only. 1 to 8192 bytes, no line breaks.</p>
      </div>
      <McpSaveErrorNotice error={error} subject="value" onReadAgain={onReadAgain} isReading={isReading} />
    </McpFormShell>
  );
}
