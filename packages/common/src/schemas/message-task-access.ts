/** A batch of message task references checked for the actor, without reading payloads. */
import { z } from 'zod';
import { idSchema } from '../ids/index.js';
import { PAGE_SIZE_MAX } from './page.js';

export const messageTaskAccessInputSchema = z.object({ messageIds: z.array(idSchema('message')).max(PAGE_SIZE_MAX) });
export const messageTaskAccessOutputSchema = z.object({ items: z.array(z.object({ messageId: idSchema('message'), canOpen: z.boolean() })) });
