import { OPERATOR_NAME, type SentencePart } from '../../../lib/sentence';
import { ShipName } from '../../../components/molecules/ship-name';

/** Each part with a key from its content and how often that content came before it, so equal parts stay apart. */
function keyed(parts: readonly SentencePart[]): { key: string; part: SentencePart }[] {
  const seen = new Map<string, number>();
  return parts.map((part) => {
    const content = part.kind === 'text' ? `text:${part.text}` : `ship:${part.party.id}`;
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return { key: `${content}#${String(occurrence)}`, part };
  });
}

/**
 * A history sentence (lib/sentence.ts): text as it is, each ship as a
 * ShipName with its id suffix, as timelines and delivery history show parties
 * (docs/design/conventions.md, "Copy"). argo never carries a suffix.
 */
export function Sentence({ parts, className }: { parts: readonly SentencePart[]; className?: string }) {
  return (
    <span className={className}>
      {keyed(parts).map(({ key, part }) =>
        part.kind === 'text' ? (
          <span key={key}>{part.text}</span>
        ) : (
          <ShipName
            key={key}
            name={part.party.name}
            shipId={part.party.id}
            isSuffixShown={part.party.name !== OPERATOR_NAME}
            className="align-baseline"
          />
        ),
      )}
    </span>
  );
}
