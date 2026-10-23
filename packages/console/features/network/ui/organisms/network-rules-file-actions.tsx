'use client';

import { FileDown, FileUp } from 'lucide-react';

import { InlineError } from '../../../../components/molecules/inline-error';
import { Button } from '@aeolus-fleet/common/header';

export interface NetworkRulesFileActionsProps {
  isExporting: boolean;
  /** Why the last export failed, as the fleet says it: nothing was downloaded. */
  exportError?: string;
  onExport: () => void;
  /** Whether the session may import: it holds labels:define beside fleet:network (design network-io, Q5); else Import is not offered. */
  canImport: boolean;
  onImport: () => void;
}

/**
 * Export and Import of the network rules on Network (design network-io):
 * Export downloads the applied rules and the labels they use as one file;
 * Import opens its four steps. Props only.
 */
export function NetworkRulesFileActions({ isExporting, exportError, onExport, canImport, onImport }: NetworkRulesFileActionsProps) {
  return (
    <section aria-labelledby="network-rules-file" data-testid="network-rules-file" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="network-rules-file" className="text-body font-semibold">
        Export and import
      </h2>
      <p className="text-meta text-muted-foreground">
        Export writes the applied rules and the labels they use as one file, by name. Import brings a file from this fleet or another into the draft.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<FileDown />} isLoading={isExporting} data-testid="network-rules-export" onClick={onExport}>
          {isExporting ? 'Exporting…' : 'Export'}
        </Button>
        {canImport ? (
          <Button icon={<FileUp />} disabled={isExporting} data-testid="network-rules-import" onClick={onImport}>
            Import…
          </Button>
        ) : null}
      </div>
      {exportError === undefined ? null : <InlineError variant="field" title="Couldn’t export the rules" description={`${exportError}. Nothing was downloaded.`} />}
    </section>
  );
}
