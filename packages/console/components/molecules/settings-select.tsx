import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../atoms/select';

interface SettingsSelectProps {
  id: string;
  /** Its items, as value to label. */
  items: Readonly<Record<string, string>>;
  value: string;
  onPick: (value: string) => void;
  isDisabled?: boolean;
  testId: string;
}

/** One select of the crew settings fields: its items, the current value, and what picking does. */
export function SettingsSelect({ id, items, value, onPick, isDisabled, testId }: SettingsSelectProps) {
  return (
    <Select
      items={items}
      value={value}
      disabled={isDisabled}
      onValueChange={(picked) => {
        if (typeof picked === 'string') {
          onPick(picked);
        }
      }}
    >
      <SelectTrigger id={id} className="h-(--size-control) w-full" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([itemValue, label]) => (
          <SelectItem key={itemValue} value={itemValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
