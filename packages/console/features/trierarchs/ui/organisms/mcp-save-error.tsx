import { RotateCw } from 'lucide-react';
import { Button, InlineError } from '@aeolus-fleet/ui';

/** Save recovery is explicit. An uncertain write remains blocked until a successful read. */
import type { McpSaveError } from '../../services/mcp-configuration';
export type { McpSaveError } from '../../services/mcp-configuration';

export function McpSaveErrorNotice({
  error,
  subject,
  onReadAgain,
  isReading = false,
}: {
  error?: McpSaveError;
  subject: string;
  onReadAgain: () => void;
  isReading?: boolean;
}) {
  if (error === undefined) return null;
  if (error.kind === 'stale')
    return (
      <InlineError
        title="Someone else changed the MCP servers"
        description={`They are at version ${error.version} now, and your change is not saved. The list behind this form is read again and your input is kept: save again to apply it to version ${error.version}.`}
      />
    );
  if (error.kind === 'no-answer' || error.kind === 'read-failed')
    return (
      <div className="flex flex-col gap-2">
        <InlineError
          title={error.kind === 'no-answer' ? 'The trierarch plugin did not answer' : 'Couldn’t read the MCP servers'}
          description={
            error.kind === 'no-answer'
              ? `Your change may or may not be saved. Save ${subject} stays off until Read again shows the version the plugin holds.`
              : `${error.message}. Your change may or may not be saved. Read again before saving.`
          }
        />
        <Button
          size="xs"
          icon={<RotateCw aria-hidden />}
          isLoading={isReading}
          onClick={onReadAgain}
          data-testid="mcp-read-again"
          className="self-start max-sm:h-(--size-control-touch)"
        >
          {isReading ? 'Reading…' : 'Read again'}
        </Button>
      </div>
    );
  return (
    <InlineError
      title={`Couldn’t save the ${subject}`}
      description={
        error.kind === 'body-too-large'
          ? 'The MCP configuration is over 1 MiB, so the console did not send it to the trierarch plugin. Nothing changed: remove servers, tools or secrets, then save again.'
          : error.message.toLowerCase().includes('does not fit one message of 256 kb once sealed')
            ? 'The MCP configuration does not fit one message of 256 KB once sealed. Nothing changed: remove servers, tools or secrets, then save again.'
            : `${error.message.replace(/\.$/, '')}. Nothing changed.`
      }
    />
  );
}
