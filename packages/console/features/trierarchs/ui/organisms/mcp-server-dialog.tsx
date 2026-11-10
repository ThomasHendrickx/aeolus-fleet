import { Plus, TriangleAlert, X } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useId, useState } from 'react';
import { Button, Checkbox, InlineError, Input, Label } from '@aeolus-fleet/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/atoms/select';
import type { McpChange, McpServer } from '../../services/mcp-configuration';
import { McpFormShell } from './mcp-form-shell';
import { McpSaveErrorNotice, type McpSaveError } from './mcp-save-error';

interface ServerFields {
  name: string;
  url: string;
  tools: string[];
  hasCredential: boolean;
  header: string;
  secret: string;
  secretName: string;
  value: string;
}
const NEW_SECRET = '';
const NAME_RULE = /^[a-z0-9][a-z0-9._-]*$/;
const NAME_ERROR = 'A name is lowercase letters, digits, dots, hyphens and underscores, and never a path';
const INPUT_PHONE = 'max-sm:h-(--size-control-touch) max-sm:text-input-touch';

/** The server form owns the only copy of a newly typed secret, until closed or saved. */
export function McpServerDialog({
  server,
  secrets,
  version,
  isPending,
  error,
  isReading,
  onReadAgain,
  onClose,
  onSave,
}: {
  server?: McpServer;
  secrets: readonly string[];
  version: number;
  isPending: boolean;
  error?: McpSaveError;
  isReading?: boolean;
  onReadAgain: () => void;
  onClose: () => void;
  onSave: (change: McpChange) => void;
}) {
  const id = useId();
  const [tool, setTool] = useState('');
  const {
    register,
    control,
    setValue,
    setError,
    clearErrors,
    handleSubmit,
    formState: { errors },
  } = useForm<ServerFields>({
    mode: 'onChange',
    defaultValues: {
      name: server?.name ?? '',
      url: server?.url ?? '',
      tools: [...(server?.tools ?? [])],
      hasCredential: server?.credential !== undefined,
      header: server?.credential?.header ?? 'Authorization',
      secret: server?.credential?.secret ?? NEW_SECRET,
      secretName: '',
      value: '',
    },
  });
  const fields = useWatch({ control });
  const tools = fields.tools ?? [];
  const isNewSecret = fields.secret === NEW_SECRET;
  const isRenamed = server !== undefined && fields.name !== server.name;
  const isBlocked = error?.kind === 'no-answer' || error?.kind === 'read-failed' || isReading;
  const addTools = (text: string) => {
    if (text.trim() === '') {
      setError('tools', { message: 'Add at least one tool' });
      return;
    }
    clearErrors('tools');
    setValue(
      'tools',
      [
        ...new Set([
          ...tools,
          ...text
            .split(/[\n,]+/)
            .map((name) => name.trim())
            .filter(Boolean),
        ]),
      ],
      { shouldValidate: true },
    );
    setTool('');
  };
  const submit = handleSubmit((values) => {
    if (values.tools.length === 0) {
      setError('tools', { message: 'Add at least one tool' });
      return;
    }
    const credential = values.hasCredential ? { header: values.header, secret: values.secret === NEW_SECRET ? values.secretName : values.secret } : undefined;
    onSave({
      kind: 'server',
      originalName: server?.name,
      server: { name: values.name, url: values.url, tools: values.tools, ...(credential === undefined ? {} : { credential }) },
      secretValues: values.hasCredential && values.secret === NEW_SECRET ? { [values.secretName]: values.value } : {},
    });
  });
  return (
    <McpFormShell
      title={server === undefined ? 'Add server' : `Edit ${server.name}`}
      description={`Saving replaces the fleet’s MCP servers at version ${version}. Machines apply it on their next pass.`}
      isPending={isPending}
      isDisabled={isBlocked}
      action={error?.kind === 'stale' ? 'Save again' : 'Save server'}
      onClose={onClose}
      onSubmit={() => {
        void submit();
      }}
    >
      <fieldset disabled={isPending} className="contents">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            isMono
            autoComplete="off"
            className={INPUT_PHONE}
            placeholder="company-graph"
            data-testid="mcp-name"
            aria-invalid={errors.name !== undefined}
            aria-describedby={`${id}-name-help`}
            {...register('name', { required: NAME_ERROR, validate: (name) => NAME_RULE.test(name) || NAME_ERROR })}
          />
          {errors.name === undefined ? (
            <p
              id={`${id}-name-help`}
              className={`text-meta ${isRenamed ? 'flex items-start gap-1.5 text-tone-waiting-fg [&_svg]:size-(--size-icon-sm)' : 'text-muted-foreground'}`}
            >
              {isRenamed ? (
                <>
                  <TriangleAlert aria-hidden />
                  Crew requests that name {server.name} will not be placed until they name {fields.name}.
                </>
              ) : (
                'Crew requests and templates choose the server by this name.'
              )}
            </p>
          ) : (
            <InlineError id={`${id}-name-help`} variant="field" title={NAME_ERROR} />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-url`}>URL</Label>
          <Input
            id={`${id}-url`}
            isMono
            className={INPUT_PHONE}
            placeholder="https://mcp.example.com/mcp"
            data-testid="mcp-url"
            aria-invalid={errors.url !== undefined}
            aria-describedby={`${id}-url-help${errors.url === undefined ? '' : ` ${id}-url-error`}`}
            {...register('url', { required: 'Enter a URL' })}
          />
          <p id={`${id}-url-help`} className="text-meta text-muted-foreground">
            Streamable HTTP, with no user, query or fragment. A credential goes below.
          </p>
          {errors.url === undefined ? null : <InlineError id={`${id}-url-error`} variant="field" title="Enter a URL" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-tool`}>Tools</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {tools.length === 0 ? (
              <span className="text-meta text-muted-foreground">None yet: add at least one</span>
            ) : (
              tools.map((name) => (
                <span key={name} className="inline-flex h-5.5 min-w-0 items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 font-mono text-id">
                  <span className="break-all">{name}</span>
                  {isPending ? null : (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      data-testid={`mcp-remove-tool-${name}`}
                      className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent [&_svg]:size-3"
                      onClick={() => {
                        setValue(
                          'tools',
                          tools.filter((each) => each !== name),
                        );
                      }}
                    >
                      <X aria-hidden />
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id={`${id}-tool`}
              aria-invalid={errors.tools !== undefined}
              aria-describedby={`${id}-tools-help${errors.tools === undefined ? '' : ` ${id}-tools-error`}`}
              isMono
              className={INPUT_PHONE}
              placeholder="tool_name"
              value={tool}
              data-testid="mcp-tool"
              onChange={(event) => {
                setTool(event.target.value);
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text');
                if (/[\n,]/.test(pasted)) {
                  event.preventDefault();
                  addTools(`${tool},${pasted}`);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTools(tool);
                }
              }}
            />
            <Button
              type="button"
              icon={<Plus aria-hidden />}
              onClick={() => {
                addTools(tool);
              }}
              data-testid="mcp-add-tool"
              className="max-sm:h-(--size-control-touch)"
            >
              Add tool
            </Button>
          </div>
          <p id={`${id}-tools-help`} className="text-meta text-muted-foreground">
            A session may call only these. Paste several, one per line or comma separated.
          </p>
          {errors.tools === undefined ? null : <InlineError id={`${id}-tools-error`} variant="field" title="Add at least one tool" />}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-body font-medium">
            <Checkbox
              id={`${id}-credential`}
              checked={fields.hasCredential ?? false}
              onCheckedChange={(isChecked) => {
                setValue('hasCredential', isChecked);
              }}
              disabled={isPending}
              data-testid="mcp-credential"
            />
            <Label htmlFor={`${id}-credential`}>Send a credential</Label>
          </div>
          {fields.hasCredential ? (
            <div className="flex flex-col gap-4 border-l-2 border-border pl-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-header`}>Header</Label>
                <Input id={`${id}-header`} isMono className={INPUT_PHONE} data-testid="mcp-header" {...register('header')} />
                <p className="text-meta text-muted-foreground">The proxy sets this header to the secret’s value. The session never sees it.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-secret`}>Secret</Label>
                <Select
                  value={fields.secret ?? NEW_SECRET}
                  disabled={isPending}
                  onValueChange={(value) => {
                    if (value !== null) setValue('secret', value);
                  }}
                >
                  <SelectTrigger id={`${id}-secret`} data-testid="mcp-secret" className="w-full font-mono max-sm:h-(--size-control-touch)">
                    <SelectValue>{isNewSecret ? 'New secret' : fields.secret}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {secrets.map((secret) => (
                      <SelectItem key={secret} value={secret} className="font-mono">
                        {secret}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SECRET}>New secret</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isNewSecret ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-secret-name`}>Secret name</Label>
                    <Input id={`${id}-secret-name`} isMono className={INPUT_PHONE} data-testid="mcp-secret-name" {...register('secretName')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-value`}>Value</Label>
                    <Input id={`${id}-value`} type="password" autoComplete="off" className={INPUT_PHONE} data-testid="mcp-value" {...register('value')} />
                    <p className="text-meta text-muted-foreground">Write-only: never shown again once saved. 1 to 8192 bytes, no line breaks.</p>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </fieldset>
      <McpSaveErrorNotice error={error} subject="server" onReadAgain={onReadAgain} isReading={isReading} />
    </McpFormShell>
  );
}
