import { FileText } from 'lucide-react';

interface LaunchNoteProps {
  /** Where to start the session, as the template says; null when it gives none. */
  note: string | null;
  /** The exact model id the template pins; null when it pins none. */
  model: string | null;
  /** Its template, as "tester@4", for the heading; none when unknown. */
  template?: string;
  testId?: string;
}

/** A role's launch note and pinned model, shown once above its members' crew lines; nothing when the template gives neither. */
export function LaunchNote({ note, model, template, testId }: LaunchNoteProps) {
  if (note === null && model === null) {
    return null;
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-meta">
      <FileText aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
      <span className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">Launch note{template === undefined ? '' : ` · ${template}`}</span>
        {note !== null && <span data-testid={testId}>{note}</span>}
        {model !== null && (
          <span>
            Runs <span className="font-mono">{model}</span>
          </span>
        )}
      </span>
    </div>
  );
}
