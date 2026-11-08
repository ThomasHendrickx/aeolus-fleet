import { z } from 'zod';

import { modelSchema } from '../schemas/message.js';

/**
 * Asking the trierarch plugin's ship for the fleet's enabled models (the
 * trierarch plugin's docs/design/enabled-models-for-ships.md, R1): any ship
 * sends the ask, and the plugin answers it as a reply with the set as it is
 * when answered.
 */

/** The content type of the ask a ship sends the trierarch plugin's ship. */
export const ENABLED_MODELS_ASK_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.enabled-models-ask+json';

/** The content type of the plugin's reply to an ask. */
export const ENABLED_MODELS_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.enabled-models+json';

/** The ask: an empty object. */
export const enabledModelsAskSchema = z.strictObject({});

export type EnabledModelsAsk = z.infer<typeof enabledModelsAskSchema>;

/** The reply: the fleet's enabled models by exact id, sorted; an empty list is no rule, every model allowed (decision 0063). */
export const enabledModelsSchema = z.strictObject({ models: z.array(modelSchema) });

export type EnabledModels = z.infer<typeof enabledModelsSchema>;
