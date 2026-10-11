'use client';

import { Boxes, Ellipsis, Pencil, Plus, Search, Ship, ShipWheel, Tags, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { classNames } from '../../../lib/class-names';
import { useConsoleConstants } from '../../../lib/console-constants';
import { matchesLabelQuery, type LabelRow, type OwnerMark } from '../../../lib/labels';
import { Button } from '../../../components/atoms/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/atoms/dropdown-menu';
import { Input } from '../../../components/atoms/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/atoms/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/atoms/table';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';

interface LabelsTableProps {
  /** The fleet's labels, yours first; undefined while they load. */
  rows: readonly LabelRow[] | undefined;
  /** How many ships are not retired: "of 15". */
  shipTotal: number;
  error?: string;
  onRetry: () => void;
  /** Define a label: offered with labels:define. */
  onDefine?: () => void;
  /** Your label's row menu: offered with labels:define. */
  onChangeValues?: (row: LabelRow) => void;
  onDelete?: (row: LabelRow) => void;
}

const MARKS: Record<Exclude<OwnerMark, 'none'>, typeof Ship> = { 'trierarch-plugin': ShipWheel, squadrons: Boxes, ship: Ship };

/** The rule every label keeps, under the list (decision 0031). */
function rulesOf(limits: { labelHandleMaxLength: number; labelValuesMax: number; shipLabelsMax: number }): string {
  return `A value opens the fleet overview filtered by it. Keys and values use lowercase letters, digits and -, up to ${String(limits.labelHandleMaxLength)} characters; a label has at most ${String(limits.labelValuesMax)} values and a ship at most ${String(limits.shipLabelsMax)} labels (decision 0031).`;
}

function plural(count: number, one: string): string {
  return `${String(count)} ${count === 1 ? one : `${one}s`}`;
}

/** A value with how many ships carry it, opening the overview filtered by it; muted on no ship. */
function ValueChip({ value }: { value: LabelRow['values'][number] }) {
  return (
    <Link
      href={`/?label=${value.valueId}`}
      data-testid="labels-value"
      title={`${value.value}: on ${value.shipCount === 0 ? 'no ship' : plural(value.shipCount, 'ship')}`}
      className={classNames(
        'inline-flex h-6 items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 font-mono text-id hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        value.shipCount === 0 ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span className="font-medium">{value.value}</span>
      <span className="font-sans text-caption text-muted-foreground tabular-nums">{value.shipCount}</span>
    </Link>
  );
}

/** Who owns the label and who assigns it: "argo (you) · Only you assign it", or read-only with its owner named. */
function Owner({ owner }: { owner: LabelRow['owner'] }) {
  const Mark = owner.mark === 'none' ? null : MARKS[owner.mark];
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 font-medium [&_svg]:size-(--size-icon-sm) [&_svg]:text-muted-foreground">
        {Mark === null ? null : <Mark aria-hidden />}
        {owner.name}
        {owner.isYours ? <span className="font-normal text-muted-foreground">(you)</span> : null}
      </span>
      <span className="text-meta text-muted-foreground">{owner.isYours ? 'Only you assign it' : `Read-only: only ${owner.name} assigns it`}</span>
    </span>
  );
}

/** Your label's menu: Change values…, and Delete label… while no ship carries it. */
function RowMenu({ row, onChangeValues, onDelete }: { row: LabelRow } & Pick<LabelsTableProps, 'onChangeValues' | 'onDelete'>) {
  if (!row.owner.isYours || (onChangeValues === undefined && onDelete === undefined)) {
    return null;
  }
  const isCarried = row.shipCount > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" isIconOnly aria-label={`Actions for ${row.key}`} icon={<Ellipsis />} data-testid="labels-row-menu" />}
      />
      <DropdownMenuContent align="end">
        {onChangeValues === undefined ? null : (
          <DropdownMenuItem
            data-testid="labels-change-values"
            onClick={() => {
              onChangeValues(row);
            }}
          >
            <Pencil aria-hidden />
            Change values…
          </DropdownMenuItem>
        )}
        {onDelete === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isCarried}
              data-testid="labels-delete"
              className="h-auto min-h-8.5 py-1.5"
              onClick={() => {
                onDelete(row);
              }}
            >
              <Trash2 aria-hidden />
              <span className="flex flex-col">
                Delete label…
                {isCarried ? <span className="text-caption text-muted-foreground">Only when no ship carries it</span> : null}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The fleet's labels (canvas Labels, LbList, LbListMenu, LbMList; #102): each
 * key with its values and how many ships carry each, its owner and who
 * assigns it, and how many ships carry it of all. Found by key or value, or
 * by owner. Your labels have a menu to change their values or delete them; the
 * others' are read-only. A table on desktop, a card per label on phone.
 */
export function LabelsTable({ rows, shipTotal, error, onRetry, onDefine, onChangeValues, onDelete }: LabelsTableProps) {
  const limits = useConsoleConstants();
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('all');

  if (error !== undefined) {
    return (
      <InlineError
        variant="page"
        title="Couldn’t load labels"
        description="This page couldn’t reach the fleet server. Nothing changed; your labels are where you left them."
        detail={error}
        onRetry={onRetry}
      />
    );
  }
  if (rows === undefined) {
    return <LoadingSkeleton variant="table" rows={5} label="Loading labels" />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Tags aria-hidden />}
        title="No labels yet"
        description="A label is a key with a set of values, like os with macos and linux. Define one, then assign it on ship pages to filter the fleet and to place crew requests on machines."
        action={
          onDefine === undefined ? undefined : (
            <Button variant="primary" icon={<Plus />} onClick={onDefine}>
              Define a label
            </Button>
          )
        }
      />
    );
  }

  const owners = [...new Set(rows.map((row) => row.owner.name))];
  const shown = rows.filter((row) => matchesLabelQuery(row, query) && (owner === 'all' || row.owner.name === owner));
  const ownerItems: Record<string, string> = { all: 'All', ...Object.fromEntries(owners.map((name) => [name, name])) };

  return (
    <div className="flex flex-col gap-3" data-testid="labels-table">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64 max-sm:min-w-0 max-sm:flex-1">
          <Input
            type="search"
            aria-label="Find a key or value"
            placeholder="Find a key or value"
            leadingIcon={<Search />}
            value={query}
            className="h-(--size-control-sm) text-meta max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            data-testid="labels-search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <Select
          items={ownerItems}
          value={owner}
          onValueChange={(value) => {
            if (value !== null) {
              setOwner(value);
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Owner">
            <span className="flex gap-1.5">
              <span className="text-muted-foreground">Owner</span>
              <SelectValue className="font-medium" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ownerItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="ml-auto text-meta text-muted-foreground tabular-nums max-sm:w-full">
          {plural(rows.length, 'label')} · {plural(owners.length, 'owner')}
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyState variant="no-results" title={`No label matches “${query.trim()}”.`} />
      ) : (
        <>
          <div className="max-sm:hidden">
            <Table aria-label="Labels">
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Values and the ships that carry each</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Ships</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.labelId} data-testid={`labels-row-${row.key}`}>
                    <TableCell className="align-top">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-body font-medium">{row.key}</span>
                        <span className="text-meta text-muted-foreground">{plural(row.values.length, 'value')}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">
                        {row.values.map((value) => (
                          <ValueChip key={value.valueId} value={value} />
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-60 align-top">
                      <Owner owner={row.owner} />
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="flex flex-col gap-0.5 tabular-nums">
                        <span>{row.shipCount}</span>
                        <span className="text-meta text-muted-foreground">of {shipTotal}</span>
                      </span>
                    </TableCell>
                    <TableCell className="w-10 text-right align-top">
                      <RowMenu row={row} onChangeValues={onChangeValues} onDelete={onDelete} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul aria-label="Labels" className="overflow-hidden rounded-lg border border-border bg-card sm:hidden">
            {shown.map((row) => (
              <li key={row.labelId} className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-0" data-testid={`labels-card-${row.key}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-body-touch font-medium">{row.key}</span>
                  <span className="flex items-center gap-1 text-meta text-muted-foreground">
                    {plural(row.shipCount, 'ship')}
                    <RowMenu row={row} onChangeValues={onChangeValues} onDelete={onDelete} />
                  </span>
                </span>
                <span className="text-meta text-muted-foreground">{row.owner.isYours ? 'By you' : `By ${row.owner.name} · read-only`}</span>
                <span className="flex flex-wrap gap-1.5">
                  {row.values.map((value) => (
                    <ValueChip key={value.valueId} value={value} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-meta text-muted-foreground">{rulesOf(limits)}</p>
    </div>
  );
}
