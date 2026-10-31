'use client';

import { useState } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/atoms/table';
import { LoadMore } from '../../../../components/molecules/load-more';
import { columnLabelOf, TOKEN_KIND_NAMES, TOKEN_KINDS, type TimeFormat, type UsageChart } from '../../services/usage-chart';

/** Rows shown before Load more, as a list page shows them. */
const ROWS_PER_PAGE = 24;

interface UsageTableProps {
  chart: UsageChart;
  format: TimeFormat;
  /** Writes a value of the measure: tokens or dollars. */
  formatValue: (value: number) => string;
}

const NUMBER = new Intl.NumberFormat('en-US');

/**
 * The chart as a table: every hour or day with usage, newest first, the
 * measure per series and its total, and each token kind in full. The way to
 * read every number by keyboard and screen reader.
 */
export function UsageTable({ chart, format, formatValue }: UsageTableProps) {
  const [shown, setShown] = useState(ROWS_PER_PAGE);
  const rows = chart.columns.filter((column) => column.total > 0 || column.segments.length > 0).toReversed();
  const valueOf = (column: (typeof rows)[number], seriesId: string) => column.segments.find((segment) => segment.seriesId === seriesId)?.value;
  return (
    <div className="flex flex-col gap-2" data-testid="usage-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{format.grain === 'day' ? 'Day' : 'Hour'}</TableHead>
            {chart.series.map((one) => (
              <TableHead key={one.id} className="text-right">
                {one.name}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
            {TOKEN_KINDS.map((kind) => (
              <TableHead key={kind} className="text-right">
                {TOKEN_KIND_NAMES[kind]} tokens
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, shown).map((column) => (
            <TableRow key={column.at} data-testid="usage-table-row">
              <TableCell className="whitespace-nowrap">{columnLabelOf(column.at, format)}</TableCell>
              {chart.series.map((one) => {
                const value = valueOf(column, one.id);
                return (
                  <TableCell key={one.id} className="text-right tabular-nums">
                    {value === undefined ? '' : formatValue(value)}
                  </TableCell>
                );
              })}
              <TableCell className="text-right font-medium tabular-nums">{formatValue(column.total)}</TableCell>
              {TOKEN_KINDS.map((kind) => (
                <TableCell key={kind} className="text-right tabular-nums" data-testid={`usage-table-${kind}`}>
                  {NUMBER.format(column.kinds[kind])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown ? (
        <LoadMore
          what="older rows"
          isLoading={false}
          isFailed={false}
          area="usage-table"
          onLoad={() => {
            setShown(shown + ROWS_PER_PAGE);
          }}
        />
      ) : null}
    </div>
  );
}
