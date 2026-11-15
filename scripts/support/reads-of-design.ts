import type { Read } from './read.ts';

const CREDENTIALS = ['fleet', 'installation', 'session'] as const;

/** The reads of the performance design: the rows of its table of reads (`| Read | Credential | Input |`), in its order. A design without one is refused. */
export function readsOfDesign(markdown: string): Read[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^\|\s*Read\s*\|\s*Credential\s*\|\s*Input\s*\|/.test(line));
  if (start === -1) {
    throw new Error('The design has no table of reads (| Read | Credential | Input |)');
  }
  const reads: Read[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) {
      break;
    }
    const [name, credential, input] = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ''));
    const found = CREDENTIALS.find((candidate) => candidate === credential);
    if (name === undefined || name === '' || found === undefined) {
      throw new Error(`A row of the table of reads is not a read and a credential: ${line}`);
    }
    reads.push({ name, procedure: name, ...(input ? { input: JSON.parse(input) as unknown } : {}), credential: found });
  }
  return reads;
}
