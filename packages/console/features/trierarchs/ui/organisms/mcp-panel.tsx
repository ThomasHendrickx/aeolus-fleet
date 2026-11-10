import { Ellipsis, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  InlineError,
  LoadingSkeleton,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@aeolus-fleet/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/atoms/table';
import type { McpConfiguration, McpServer } from '../../services/mcp-configuration';

/** The read-only metadata of the bounded MCP set. Values never belong to this part. */
export interface McpPanelProps {
  configuration?: McpConfiguration;
  error?: string;
  isRetrying?: boolean;
  onRetry: () => void;
  onEdit: (server: McpServer) => void;
  onRemoveServer: (server: McpServer) => void;
  onReplaceValue: (secret: string) => void;
  onRemoveSecret: (secret: string) => void;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full h-5.5 items-center rounded-sm border border-border bg-secondary px-1.5 font-mono text-id text-foreground">
      <span className="break-all">{children}</span>
    </span>
  );
}

function ToolChips({ tools, isPhone = false }: { tools: readonly string[]; isPhone?: boolean }) {
  const max = isPhone ? tools.length : 3;
  const folded = tools.slice(max).join(', ');
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {tools.slice(0, max).map((tool) => (
        <Chip key={tool}>{tool}</Chip>
      ))}
      {folded === '' ? null : (
        <Tooltip>
          <TooltipTrigger render={<span role="img" aria-label={folded} className="text-meta text-muted-foreground tabular-nums" />}>
            +{tools.length - max}
          </TooltipTrigger>
          <TooltipContent>{folded}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
function Credential({ server }: { server: McpServer }) {
  return server.credential === undefined ? (
    <span className="text-meta text-muted-foreground">None</span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-id">
      <KeyRound aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" />
      <span className="break-all">
        {server.credential.header} · {server.credential.secret}
      </span>
    </span>
  );
}
interface MenuItem {
  label: string;
  icon: ReactNode;
  isDestructive?: boolean;
  onClick: () => void;
}
function RowMenu({ name, items, isPhone = false }: { name: string; items: readonly MenuItem[]; isPhone?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = (
    <Button
      size={isPhone ? 'touch' : 'xs'}
      variant="ghost"
      isIconOnly
      aria-label={`Actions for ${name}`}
      data-testid={`mcp-actions-${name}`}
      icon={<Ellipsis aria-hidden />}
    />
  );
  if (isPhone)
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{name}</SheetTitle>
          </SheetHeader>
          <ul className="flex flex-col pb-2">
            {items.map((item) => (
              <li key={item.label} className={item.isDestructive ? 'mt-1 border-t border-border pt-1' : undefined}>
                <button
                  type="button"
                  className={`flex min-h-(--size-control-touch) w-full items-center gap-3 px-4 text-left text-body-touch [&_svg]:size-(--size-icon) ${item.isDestructive ? 'text-destructive-text' : 'text-foreground'}`}
                  data-testid={`mcp-menu-${item.isDestructive ? 'remove' : 'edit'}`}
                  onClick={() => {
                    setIsOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon}
                  {item.label.replace(/…$/, '')}
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4">
            <Button
              size="touch"
              className="w-full"
              onClick={() => {
                setIsOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <span key={item.label} className="contents">
            {item.isDestructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              data-testid={`mcp-menu-${item.isDestructive ? 'remove' : 'edit'}`}
              className={item.isDestructive ? 'text-destructive-text' : undefined}
              onClick={item.onClick}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-section font-semibold">
      {title}
      {count === undefined ? null : <Badge variant="count">{count}</Badge>}
    </h2>
  );
}
function VersionLine({ version }: { version: number }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
      <Badge variant="outline" className="tabular-nums">
        Version {version}
      </Badge>
      A session gets a server only when its crew request names it. Machines apply the latest version on their next pass.
    </p>
  );
}

export function McpPanel({ configuration, error, isRetrying, onRetry, onEdit, onRemoveServer, onReplaceValue, onRemoveSecret }: McpPanelProps) {
  if (error !== undefined)
    return (
      <InlineError
        variant="page"
        title="Couldn’t read the MCP servers"
        description="Nothing changed. The page shows them once the read succeeds."
        detail={error}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  if (configuration === undefined)
    return (
      <div className="flex flex-col gap-4">
        <SectionTitle title="Servers" />
        <LoadingSkeleton variant="table" rows={3} label="Loading the MCP servers" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={3} label="Loading the MCP servers" className="sm:hidden" />
        <SectionTitle title="Secrets" />
        <LoadingSkeleton variant="table" rows={2} label="Loading the secrets" className="max-sm:hidden" />
        <LoadingSkeleton variant="list" rows={2} label="Loading the secrets" className="sm:hidden" />
      </div>
    );
  const { servers, secrets } = configuration;
  const serverItems = (server: McpServer): MenuItem[] => [
    {
      label: 'Edit…',
      icon: <Pencil aria-hidden />,
      onClick: () => {
        onEdit(server);
      },
    },
    {
      label: 'Remove…',
      icon: <Trash2 aria-hidden />,
      isDestructive: true,
      onClick: () => {
        onRemoveServer(server);
      },
    },
  ];
  const users = (secret: string) => servers.filter((server) => server.credential?.secret === secret).map((server) => server.name);
  const usedBy = (secret: string) =>
    users(secret).length === 0 ? (
      <span className="text-meta text-muted-foreground">No server</span>
    ) : (
      <span className="flex flex-wrap gap-1.5">
        {users(secret).map((name) => (
          <Chip key={name}>{name}</Chip>
        ))}
      </span>
    );
  const secretItems = (secret: string): MenuItem[] => [
    {
      label: 'Replace value…',
      icon: <KeyRound aria-hidden />,
      onClick: () => {
        onReplaceValue(secret);
      },
    },
    ...(users(secret).length > 0
      ? []
      : [
          {
            label: 'Remove…',
            icon: <Trash2 aria-hidden />,
            isDestructive: true,
            onClick: () => {
              onRemoveSecret(secret);
            },
          },
        ]),
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="mcp-panel">
      <VersionLine version={configuration.version} />
      {servers.length === 0 && secrets.length === 0 ? (
        <EmptyState
          title="No MCP servers yet"
          description="Add a server to offer its tools to the crew requests that name it. Its credential’s secret shows here once saved."
        />
      ) : (
        <>
          <section className="flex min-w-0 flex-col gap-3">
            <SectionTitle title="Servers" count={servers.length} />
            <div className="max-sm:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Name', 'URL', 'Tools', 'Credential'].map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servers.map((server) => (
                    <TableRow key={server.name}>
                      <TableCell className="font-mono text-id font-medium break-all">{server.name}</TableCell>
                      <TableCell className="font-mono text-id break-all text-muted-foreground">{server.url}</TableCell>
                      <TableCell>
                        <ToolChips tools={server.tools} />
                      </TableCell>
                      <TableCell>
                        <Credential server={server} />
                      </TableCell>
                      <TableCell className="text-right">
                        <RowMenu name={server.name} items={serverItems(server)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card sm:hidden">
              {servers.map((server) => (
                <li key={server.name} className="flex min-w-0 flex-col gap-2 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-body-touch font-medium break-all">{server.name}</span>
                    <RowMenu name={server.name} items={serverItems(server)} isPhone />
                  </div>
                  <span className="font-mono text-id break-all text-muted-foreground">{server.url}</span>
                  <ToolChips tools={server.tools} isPhone />
                  <Credential server={server} />
                </li>
              ))}
            </ul>
          </section>
          <section className="flex min-w-0 flex-col gap-3">
            <SectionTitle title="Secrets" count={secrets.length} />
            <p className="text-meta text-muted-foreground">A value is never shown again once saved. Replace it to change it.</p>
            <div className="max-sm:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secrets.map((secret) => (
                    <TableRow key={secret}>
                      <TableCell className="font-mono text-id font-medium break-all">{secret}</TableCell>
                      <TableCell>{usedBy(secret)}</TableCell>
                      <TableCell className="text-right">
                        <RowMenu name={secret} items={secretItems(secret)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card sm:hidden">
              {secrets.map((secret) => (
                <li key={secret} className="flex flex-col gap-2 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-body-touch font-medium break-all">{secret}</span>
                    <RowMenu name={secret} items={secretItems(secret)} isPhone />
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">Used by {usedBy(secret)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
