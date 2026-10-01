import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Search, Tag } from 'lucide-react';
import { useState } from 'react';

import { Badge } from './badge';
import { Combobox, type ComboboxOption } from './combobox';

const SHIPS: ComboboxOption[] = [
  { value: 'shp_reviewer01', label: 'reviewer-01', detail: 'reviewer', trailing: <Badge variant="secondary">Crewed</Badge> },
  { value: 'shp_reviewer02', label: 'reviewer-02', detail: 'reviewer', trailing: <Badge variant="secondary">Crewed</Badge> },
  { value: 'shp_builder', label: 'builder-core', detail: 'builder' },
];

const TYPES: ComboboxOption[] = [
  { value: 'reviewer', label: 'reviewer', trailing: <span className="text-meta text-muted-foreground">2 ships</span> },
  { value: 'builder', label: 'builder', trailing: <span className="text-meta text-muted-foreground">1 ship</span> },
];

function Field({
  isFreeText = false,
  initial = null,
  isInvalid = false,
}: {
  isFreeText?: boolean;
  initial?: string | null;
  isInvalid?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div className="flex max-w-90 flex-col gap-1.5">
      <Combobox
        options={isFreeText ? TYPES : SHIPS}
        value={value}
        onValueChange={setValue}
        isFreeText={isFreeText}
        groupLabel={isFreeText ? undefined : 'Ships'}
        emptyText={(query) => (isFreeText ? null : `No ship matches "${query}". Retired ships are not listed.`)}
        leadingIcon={isFreeText ? <Tag /> : <Search />}
        placeholder={isFreeText ? 'Type' : 'Choose a ship'}
        aria-label={isFreeText ? 'Type' : 'Ship'}
        isInvalid={isInvalid}
      />
      <p className="text-meta text-muted-foreground">Value: {value ?? 'none'}</p>
    </div>
  );
}

const meta = {
  title: 'Atoms/Combobox',
  component: Field,
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Type to search: the suggestions open only after the operator types ("revi"). */
export const Empty: Story = {};

/** A chosen ship shows its type and badge beside its name. */
export const ClosedWithValue: Story = { args: { initial: 'shp_reviewer01' } };

/** Free text: the typed type is the value; the types in use only suggest. */
export const FreeTextWithSuggestions: Story = { args: { isFreeText: true, initial: 'rev' } };

export const Invalid: Story = { args: { isFreeText: true, initial: 'deployer', isInvalid: true } };
