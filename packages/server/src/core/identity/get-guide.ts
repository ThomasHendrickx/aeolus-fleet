import type { Guide } from './guide.js';
import type { GuideRepository } from './ports.js';

export type GetGuide = () => Promise<Guide | null>;

/** Use case: the guide the installation set (decision 0024); none before it sets one. */
export function createGetGuide(deps: { guide: GuideRepository }): GetGuide {
  return () => deps.guide.read();
}
