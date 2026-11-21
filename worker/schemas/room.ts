/** Runtime validation for the room protocol (contracts/net.ts). Every inbound frame and upgrade query passes here. */
import { z } from 'zod';
import { NET_LIMITS, PROTOCOL_VERSION, type ClientMessage, type PresenterControls, type RoomRole } from '../../src/contracts/net';

/** Content ids (vehicle, suspension, section): kebab-case. */
const contentId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
/** Anonymous client uuid (or any short token of the same alphabet). */
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,36}$/);
export const hostKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const roleSchema = z.enum(['viewer', 'screen', 'host', 'audience', 'driver']) satisfies z.ZodType<RoomRole>;

export interface UpgradeQuery {
  readonly id: string;
  readonly role: RoomRole;
  readonly v?: string;
  readonly s?: string;
  readonly pv: number;
}

/** `/ws/<CODE>?id=&role=&v=&s=&pv=`; `pv` is checked separately so a stale client gets close 4400. */
export const upgradeQuerySchema: z.ZodType<UpgradeQuery> = z.object({
  id: clientIdSchema,
  role: roleSchema,
  v: contentId.exactOptional(),
  s: contentId.exactOptional(),
  pv: z.coerce.number().int(),
});

export function parseUpgradeQuery(params: URLSearchParams): UpgradeQuery | null {
  const raw: Record<string, string> = {};
  for (const key of ['id', 'role', 'v', 's', 'pv']) {
    const value = params.get(key);
    if (value !== null && value !== '') raw[key] = value;
  }
  const result = upgradeQuerySchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const isCurrentProtocol = (q: UpgradeQuery): boolean => q.pv === PROTOCOL_VERSION;

export const presenterControlsSchema: z.ZodType<PresenterControls> = z.strictObject({
  vehicleId: contentId.exactOptional(),
  suspensionId: contentId.exactOptional(),
  view: z.enum(['follow', 'explore', 'closeup']).exactOptional(),
  xray: z.boolean().exactOptional(),
  overlay: z.enum(['clean', 'engineer']).exactOptional(),
  timeScale: z.number().min(0.05).max(1).exactOptional(),
  amplification: z.number().min(1).max(10).exactOptional(),
  attract: z.boolean().exactOptional(),
  section: contentId.exactOptional(),
});

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const clientMessageSchema: z.ZodType<ClientMessage> = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('auth'), k: hostKeySchema }),
  z.strictObject({ t: z.literal('sync'), c0: z.number().finite() }),
  z.strictObject({ t: z.literal('pick'), vehicleId: contentId, suspensionId: contentId }),
  z.strictObject({ t: z.literal('ctl'), set: presenterControlsSchema }),
  z.strictObject({ t: z.literal('cue'), cue: z.enum(['replay-section', 'focus-front-left', 'focus-car']) }),
  z.strictObject({
    t: z.literal('poll'),
    poll: z
      .strictObject({
        question: trimmed(NET_LIMITS.pollQuestionChars),
        options: z.array(trimmed(NET_LIMITS.pollOptionChars)).min(2).max(NET_LIMITS.pollOptionsMax),
      })
      .nullable(),
  }),
  z.strictObject({
    t: z.literal('vote'),
    pollId: z.string().min(1).max(36),
    choice: z.number().int().min(0).max(NET_LIMITS.pollOptionsMax - 1),
  }),
  // Driver input (M2): u32 sequence, fixed-point steer/pedals, 3 flag bits.
  z.strictObject({ t: z.literal('in'), n: int(0, 0xffffffff), s: int(-1000, 1000), th: int(0, 1000), br: int(0, 1000), f: int(0, 7) }),
  // Screen telemetry (M2): km/h, gear (-1 reverse), DriveMode index, haptic bits.
  z.strictObject({ t: z.literal('tel'), v: int(0, 999), g: int(-1, 12), m: int(0, 3), k: int(0, 3) }),
]);

/** JSON text frame -> validated message, or null (unparsable / invalid). */
export function parseClientMessage(text: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}
