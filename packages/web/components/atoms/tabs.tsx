'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { classNames } from '../../lib/class-names';

/**
 * shadcn Tabs on Base UI (docs/design/png/Tabs.png). Segmented (the shadcn
 * default list) switches views of one list: Open, Done, All. Line splits a
 * page into sections: Inbox, Sent, Timeline. On phone both become the
 * full-width segmented control at touch height.
 */
const PHONE_SEGMENTED_LIST =
  'max-sm:flex max-sm:w-full max-sm:gap-0.5 max-sm:rounded-lg max-sm:border max-sm:border-border max-sm:bg-muted max-sm:p-1';
const PHONE_SEGMENTED_TAB =
  'max-sm:h-(--size-control-touch) max-sm:flex-1 max-sm:rounded-md max-sm:border-0 max-sm:px-3 max-sm:text-body-touch max-sm:data-active:bg-card max-sm:data-active:shadow-sm';

const tabsListVariants = cva('', {
  variants: {
    variant: {
      segmented: 'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.75',
      line: 'flex items-center gap-6 border-b border-border',
    },
  },
  defaultVariants: { variant: 'segmented' },
});

const tabVariants = cva(
  'group/tab inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--duration-fast) outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-active:text-foreground data-disabled:pointer-events-none data-disabled:opacity-45',
  {
    variants: {
      variant: {
        segmented: 'h-7 gap-1.5 rounded-sm px-2.5 text-meta data-active:bg-card data-active:shadow-sm',
        line: 'mb-[-1px] h-10 border-b-2 border-transparent px-0.5 text-body data-active:border-foreground',
      },
    },
    defaultVariants: { variant: 'segmented' },
  },
);

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>['variant']>;

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={classNames('flex flex-col gap-4', className)} {...props} />;
}

function TabsList({
  className,
  variant = 'segmented',
  ...props
}: TabsPrimitive.List.Props & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={classNames(tabsListVariants({ variant }), PHONE_SEGMENTED_LIST, className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant = 'segmented',
  ...props
}: TabsPrimitive.Tab.Props & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={classNames(tabVariants({ variant }), PHONE_SEGMENTED_TAB, className)}
      {...props}
    />
  );
}

/** The count a tab carries: a plain number in a segmented tab, a small pill in a line tab. */
function TabsCount({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="tabs-count"
      className={classNames(
        'text-muted-foreground tabular-nums group-data-active/tab:text-foreground in-data-[variant=line]:inline-flex in-data-[variant=line]:size-5 in-data-[variant=line]:items-center in-data-[variant=line]:justify-center in-data-[variant=line]:rounded-full in-data-[variant=line]:bg-secondary in-data-[variant=line]:text-micro',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={classNames('outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger };
