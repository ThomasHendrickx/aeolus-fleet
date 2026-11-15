import { consolePaletteListOf } from '../../../lib/palette-list';
import { squadronsUrlFrom } from '../../../lib/squadrons-url';

// Read per request: whether the console has squadrons is the running server's setting.
export const dynamic = 'force-dynamic';

/** The console's palette list, with no sign-in, for the other Aeolus apps' servers (header design H4). */
export function GET(): Response {
  return Response.json(consolePaletteListOf({ hasSquadrons: squadronsUrlFrom(process.env) !== undefined }));
}
