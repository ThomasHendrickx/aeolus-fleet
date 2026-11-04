'use client';

import { Plus, X } from 'lucide-react';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@aeolus-fleet/ui';

interface McpServersFieldProps {
  shipName: string;
  /** The servers picked, by name, in the order picked. */
  picked: readonly string[];
  /** The servers the answering machines offer for the harness picked. */
  offered: readonly string[];
  isDisabled?: boolean;
  onAdd: (server: string) => void;
  onRemove: (server: string) => void;
}

/** One server picked: its name in mono, with an × that takes it out unless the field is off. */
function ServerChip({ server, onRemove }: { server: string; onRemove: (() => void) | undefined }) {
  return (
    <span
      data-testid="mcp-server"
      className="inline-flex h-5.5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 font-mono text-id whitespace-nowrap text-foreground [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      <span className="truncate">{server}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${server}`}
          onClick={onRemove}
          className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden />
        </button>
      )}
    </span>
  );
}

/**
 * A crew request's MCP servers (docs/design/crew-mcp-servers, Q1 to Q3): "None"
 * when empty; each server picked a mono chip with ×, then Add server, which
 * offers only what the answering machines offer for the harness, so a
 * request cannot wait on a server no machine gives. Once every server offered
 * is picked, Add server stays, off, and says why, so the field keeps its shape.
 */
export function McpServersField({ shipName, picked, offered, isDisabled = false, onAdd, onRemove }: McpServersFieldProps) {
  const remaining = offered.filter((server) => !picked.includes(server));
  const isAllPicked = offered.length > 0 && remaining.length === 0;
  const addServer = (
    <Button type="button" variant="ghost" size="xs" icon={<Plus />} disabled={isDisabled || isAllPicked} focusableWhenDisabled={isAllPicked && !isDisabled} data-testid="mcp-servers-add">
      Add server
    </Button>
  );
  return (
    <div className="flex flex-col gap-1.5" data-testid="mcp-servers">
      <span className="text-body font-medium">
        MCP servers<span className="font-normal text-muted-foreground"> optional</span>
      </span>
      <div className="flex min-h-(--size-control-sm) flex-wrap items-center gap-1.5">
        {picked.length === 0 ? <span className="text-meta text-muted-foreground">None</span> : null}
        {picked.map((server) => (
          <ServerChip
            key={server}
            server={server}
            onRemove={
              isDisabled
                ? undefined
                : () => {
                    onRemove(server);
                  }
            }
          />
        ))}
        {isAllPicked ? (
          <Tooltip>
            {/* Focusable while off, so hover and focus say why. */}
            <TooltipTrigger render={addServer} />
            <TooltipContent>Every offered server is added.</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger render={addServer} />
            <DropdownMenuContent align="start">
              {remaining.length === 0 ? (
                <p data-testid="mcp-servers-none-offered" className="max-w-64 px-2 py-1.5 text-meta text-muted-foreground">
                  No machine offers an MCP server for this harness yet.
                </p>
              ) : (
                remaining.map((server) => (
                  <DropdownMenuItem
                    key={server}
                    className="font-mono text-id"
                    onClick={() => {
                      onAdd(server);
                    }}
                  >
                    {server}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        {shipName}’s session starts with these servers’ tools, read-only. The plugin places it only on a machine that offers every one.
      </p>
    </div>
  );
}
