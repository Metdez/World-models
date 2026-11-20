/**
 * AI Race Engineer: POST /api/engineer. Wire format uses DISPLAY units with explicit suffixes.
 * The client computes every number; the model may only quote numbers present in `telemetry`
 * (the worker enforces this and falls back otherwise). Tools are executed in the browser.
 */
import type { ViewMode } from './store';
import type { ComponentRole, VehicleClass } from './suspension';
import type { CornerId } from './units';

export const ENGINEER_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const ENGINEER_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash';
export const ENGINEER_MAX_OUTPUT_TOKENS = 160;
export const ENGINEER_MAX_ACTIONS = 2;

export interface EngineerCorner {
  readonly camber_deg: number;
  readonly toe_deg: number;
  readonly travel_mm: number;
  readonly load_n: number;
  readonly grip_use: number;
}

export interface EngineerTelemetry {
  readonly vehicle_class: VehicleClass;
  readonly vehicle: string;
  readonly suspension: string;
  /** Track section id + display name. */
  readonly section: string;
  readonly section_name: string;
  /** Client-derived plain-language label, e.g. "mid-corner, left-hander, outside wheel loaded". */
  readonly event: string;
  readonly speed_kmh: number;
  readonly lat_g: number;
  readonly long_g: number;
  readonly roll_deg: number;
  readonly pitch_deg: number;
  readonly corners: Readonly<Partial<Record<CornerId, EngineerCorner>>>;
  /** Extra computed values, e.g. { roll_centre_front_mm: 62, camber_gain_front_deg_per_10mm: -0.4 }. */
  readonly derived: Readonly<Record<string, number>>;
}

export interface EngineerTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface EngineerRequest {
  /** 1..NET_LIMITS.engineerQuestionChars */
  readonly question: string;
  readonly telemetry: EngineerTelemetry;
  /** <= NET_LIMITS.engineerHistoryMax turns. */
  readonly history: readonly EngineerTurn[];
}

export type EngineerAction =
  | { readonly tool: 'switch_suspension'; readonly args: { readonly id: string } }
  | { readonly tool: 'set_view'; readonly args: { readonly view: ViewMode; readonly corner?: CornerId } }
  | { readonly tool: 'set_slow_motion'; readonly args: { readonly scale: number } }
  | { readonly tool: 'highlight_component'; readonly args: { readonly component: ComponentRole; readonly corner: CornerId | 'all' } }
  | { readonly tool: 'jump_to_section'; readonly args: { readonly section: string } };

export type EngineerToolName = EngineerAction['tool'];

export interface EngineerResponse {
  /** 1-3 sentences, plain text. */
  readonly text: string;
  /** Validated, at most ENGINEER_MAX_ACTIONS. */
  readonly actions: readonly EngineerAction[];
  /** 'fallback' = rule-based answer (quota, error, failed number check). */
  readonly source: 'model' | 'fallback';
}

/** OpenAI-style function tool schema (Workers AI `tools` parameter). */
export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: EngineerToolName;
    readonly description: string;
    readonly parameters: {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
    };
  };
}

const COMPONENTS: readonly ComponentRole[] = [
  'upper-arm', 'lower-arm', 'lateral-link', 'trailing-link', 'tie-rod', 'strut', 'spring', 'damper',
  'upright', 'anti-roll-bar', 'fork', 'swingarm', 'linkage', 'tyre',
];
const CORNERS: readonly CornerId[] = ['fl', 'fr', 'rl', 'rr', 'f', 'r'];

/** Tool schemas with enums filled from content (suspension ids of the active vehicle class, track section ids). */
export function buildEngineerTools(ids: { readonly suspensions: readonly string[]; readonly sections: readonly string[] }): ToolSchema[] {
  const fn = (name: EngineerToolName, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn('switch_suspension', 'Switch the vehicle to a different suspension type.', { id: { type: 'string', enum: ids.suspensions } }, ['id']),
    fn('set_view', 'Change the camera: follow the car, explore freely, or a suspension close-up of one corner.', {
      view: { type: 'string', enum: ['follow', 'explore', 'closeup'] },
      corner: { type: 'string', enum: CORNERS },
    }, ['view']),
    fn('set_slow_motion', 'Set simulation speed. 1 = normal, 0.1 = very slow.', { scale: { type: 'number', minimum: 0.1, maximum: 1 } }, ['scale']),
    fn('highlight_component', 'Make one suspension component glow.', {
      component: { type: 'string', enum: COMPONENTS },
      corner: { type: 'string', enum: [...CORNERS, 'all'] },
    }, ['component', 'corner']),
    fn('jump_to_section', 'Move the car to the start of a named track section.', { section: { type: 'string', enum: ids.sections } }, ['section']),
  ];
}
