import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Table, themed to docs/design/png/Table.png: a card, header 40 px on
 * --muted, rows 48 px, 16 px cell padding, one row action in the last column.
 * A row marked data-new highlights with --highlight and fades over 600 ms.
 * Whole rows are not links; the name in the row is, and its focus outlines the
 * row.
 */
function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto rounded-lg border border-border bg-card shadow-sm"
    >
      <table data-slot="table" className={classNames('w-full caption-bottom text-body', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={classNames('bg-muted [&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={classNames('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={classNames(
        'h-(--size-row) border-b border-border transition-colors duration-(--duration-fast) hover:bg-muted has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring data-new:animate-highlight [thead_&]:h-(--size-row-header) [thead_&]:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={classNames(
        'px-4 text-left align-middle text-caption font-medium whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={classNames('px-4 align-middle', className)} {...props} />;
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={classNames('mt-4 text-meta text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow };
