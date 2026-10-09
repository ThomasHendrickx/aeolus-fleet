'use client';

import { useState } from 'react';

import { offersOf } from '../../lib/crew-settings-form';
import { useLabelContext } from '../../lib/fleet';
import { formMembersOf } from '../../lib/forming-members';
import { machineLabelsInputOf } from '../../lib/machine-labels';
import { useBlueprintCrew, useFormSquadron } from '../../lib/squadrons-api';
import type { TemplateVersion } from '../../lib/squadrons-schemas';
import type { BlueprintChoice } from '../../lib/squadrons-view';
import { useHasTrierarchPlugin, useMachines } from '../../lib/trierarch-plugin';
import { FormSquadronDialog } from './form-squadron-dialog';

interface FormSquadronProps {
  blueprints: readonly BlueprintChoice[];
  templates: readonly TemplateVersion[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  initial?: { key: string; version: number };
  /** The squadron is formed: the page opens it. */
  onFormed: (squadronId: string) => void;
}

/**
 * Forming a squadron, wired (#343, S4): with the trierarch plugin on, step 2
 * reads each member's crew settings from squadrons, what the machines offer
 * and the fleet's labels, and forming sends what the form holds, so squadrons
 * requests a crew for each member. Without the plugin, members are crewed by
 * hand with their crew lines, as before.
 */
export function FormSquadron({ blueprints, templates, isOpen, onOpenChange, initial, onFormed }: FormSquadronProps) {
  const hasTrierarchs = useHasTrierarchPlugin();
  const form = useFormSquadron();
  const [picked, setPicked] = useState<{ repository: string; name: string; version: number }>();
  const crew = useBlueprintCrew(hasTrierarchs ? picked : undefined);
  const machines = useMachines();
  const context = useLabelContext();
  const machineLabels = context === undefined || machines.data === undefined ? undefined : machineLabelsInputOf(context, machines.data);

  return (
    <FormSquadronDialog
      blueprints={blueprints}
      templates={templates}
      {...(initial === undefined ? {} : { initial })}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isPending={form.isPending}
      {...(form.error === null ? {} : { error: form.error.message })}
      onPicked={(blueprint) => {
        form.reset();
        setPicked(blueprint);
      }}
      {...(hasTrierarchs
        ? {
            crew: {
              state: crew.isError || machines.isError ? 'error' : crew.data === undefined || machines.data === undefined ? 'loading' : 'ready',
              members: crew.data ?? [],
              offers: offersOf(machines.data ?? []),
              ...(context === undefined ? {} : { context }),
              ...(machineLabels === undefined ? {} : { machineLabels }),
              ...(crew.error === null ? (machines.error === null ? {} : { error: machines.error.message }) : { error: crew.error.message }),
              onRetry: () => {
                void crew.refetch();
                void machines.refetch();
              },
            },
          }
        : {})}
      onSubmit={(blueprint, members) => {
        form.mutate(
          { blueprint, ...(members === undefined ? {} : { members: formMembersOf(members, context) }) },
          {
            onSuccess: (formed) => {
              onFormed(formed.squadronId);
            },
          },
        );
      }}
    />
  );
}
