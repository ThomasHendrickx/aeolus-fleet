'use client';

import { Checkbox, Input } from '@aeolus-fleet/ui';
import { useId } from 'react';
import { Search } from 'lucide-react';

/** Individual permissions, searched in plain words or by scope, shared by commission and live editing. */
export function PermissionChoices({ choices, picked, onPick, query, onQueryChange, isDisabled = false }: {
  choices: readonly { scope: string; description: string; isLocked?: boolean; hint?: string }[];
  picked: readonly string[];
  onPick: (picked: readonly string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  isDisabled?: boolean;
}) {
  const id = useId();
  const listed = choices.filter(({ scope, description }) => `${permissionName(scope, description)} ${scope} ${description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="flex flex-col gap-1.5">
    <div className="relative">
      <Search aria-hidden className="absolute left-3 top-1/2 size-(--size-icon) -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Find a permission" placeholder="Find a permission" value={query} onChange={(event) => { onQueryChange(event.target.value); }} className="pl-8" disabled={isDisabled} data-testid="permissions-search" />
    </div>
    <div className="max-h-60 overflow-y-auto rounded-md border border-border" data-testid="permissions-choices">
      {listed.length === 0 ? <p className="p-3 text-meta text-muted-foreground">No permissions match “{query}”.</p> : listed.map((choice) => <label htmlFor={`${id}-${choice.scope}`} key={choice.scope} className="flex items-start gap-2.5 border-b border-border p-3 last:border-b-0">
        <Checkbox id={`${id}-${choice.scope}`} checked={picked.includes(choice.scope)} disabled={isDisabled || choice.isLocked} onCheckedChange={(isChecked) => { onPick(isChecked ? [...picked, choice.scope] : picked.filter((scope) => scope !== choice.scope)); }} aria-label={permissionName(choice.scope, choice.description)} data-testid="permissions-choice" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body font-medium">{permissionName(choice.scope, choice.description)}</span>
          <span className="text-meta text-muted-foreground"><span className="font-mono text-id">{choice.scope}</span>{choice.hint === undefined ? ` · ${choice.description}` : ` · ${choice.hint}`}</span>
        </span>
      </label>)}
    </div>
  </div>;
}

const PERMISSION_NAMES: Readonly<Record<string, string>> = {
  'messages:send': 'Send messages', 'messages:receive': 'Receive messages', 'messages:force': 'Send a forced message', 'messages:resend': 'Resend or dismiss deliveries',
  'meetings:open': 'Open a meeting', 'fleet:read': 'Read the fleet', 'fleet:commission': 'Commission ships', 'fleet:manage': 'Manage ships', 'fleet:person': 'Commission person ships', 'fleet:owner': 'Change ship owners', 'fleet:explain': 'Explain reach', 'fleet:connect': 'Connect plugins', 'fleet:verify': 'Verify facts', 'fleet:alert': 'Raise alerts', 'fleet:keys': 'Manage sealing keys', 'fleet:network': 'Change network rules', 'fleet:on-behalf': 'Act for another ship',
  'crew:assign': 'Assign crew requests', 'crew:run': 'Crew ships', 'labels:define': 'Define labels', 'labels:assign': 'Assign own labels', 'labels:any': 'Assign any label', 'scopes:declare': 'Declare plugin permissions', 'scopes:grant': 'Change ship permissions', 'scopes:define': 'Define fleet permissions',
  'squadrons:form': 'Form a squadron', 'squadrons:scale': 'Change squadron members',
};

function permissionName(scope: string, description: string): string {
  return PERMISSION_NAMES[scope] ?? description.replace(/\.$/, '');
}
