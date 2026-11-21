import { z } from 'zod';
import { REPLAY_API, ROOM_CODE_ALPHABET, type ReplaySaveRequest } from '../../src/contracts/net';

/** base64url (no padding) of at most REPLAY_API.maxBytes bytes. */
export const MAX_DATA_CHARS = Math.ceil((REPLAY_API.maxBytes * 4) / 3);
/** Body cap before parsing: the data field plus the token and JSON punctuation. */
export const MAX_BODY_BYTES = 96 * 1024;

export const replaySaveSchema = z
  .strictObject({
    // Turnstile tokens are at most 2048 characters.
    token: z.string().min(1).max(2048),
    data: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  })
  .readonly();

/** Replay ids: REPLAY_API.idLength characters of the room-code alphabet. */
export const REPLAY_ID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${REPLAY_API.idLength}}$`);

// Compile-time check that the schema matches the frozen contract both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesContract: Same<z.infer<typeof replaySaveSchema>, ReplaySaveRequest> = true;
void schemaMatchesContract;
