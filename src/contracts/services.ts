/**
 * Client-only service contracts (import three.js TYPES). sim-core and worker/ must NOT import this file.
 */
import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { serviceKey, type Assets, type QualitySettings } from './app';
import type { DriveIntent, DriveSource } from './drive';
import type { ClientMessage, RoomRole, ServerMessage } from './net';
import type { ComponentRole, SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { CornerId } from './units';
import type { VehicleDefinition } from './vehicle';

export interface RenderStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly pixelRatio: number;
}

/** Provided by the `renderer` feature. Scene is Y-up (see units.ts for the sim->three mapping). */
export interface RenderService {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /** Owned by renderer, posed exclusively by the `camera` feature. */
  readonly camera: PerspectiveCamera;
  /** Adds to the scene; returns the remover (register it with ctx.addDisposer). */
  add(object: Object3D): () => void;
  /** Effective settings: tier preset; pixel ratio adjusted by the adaptive governor. */
  readonly quality: QualitySettings;
  /** Compile all programs for what is currently in the scene (call behind the loading overlay). */
  compile(): Promise<void>;
  stats(): RenderStats;
}

export type ShotKind = 'chase' | 'orbit' | 'closeup' | 'trackside' | 'overhead' | 'front-view';

export interface DirectorShot {
  readonly kind: ShotKind;
  readonly corner?: CornerId;
  readonly durationS: number;
  /** Vertical FOV, deg (default per kind). */
  readonly fov?: number;
}

/** Provided by the `camera` feature. View mode itself is store state (AppState.view). */
export interface CameraService {
  /** Scripted shot (attract mode, presenter cues). Cleared by clearShot(), a view change or user input. */
  playShot(shot: DirectorShot): void;
  clearShot(): void;
  readonly transitioning: boolean;
}

/** Provided by the `live-lab` feature (one WebSocket per app). */
export interface RoomService {
  readonly code: string | null;
  readonly role: RoomRole | null;
  /** Only set on the big screen that created the room (shown as QR fragment #k=). */
  readonly hostKey: string | null;
  /** Phone-driver pairing key, only on the big screen that created the room (QR fragment #d=) (M2). */
  readonly driverKey?: string | null;
  readonly connected: boolean;
  send(message: ClientMessage): void;
  on<T extends ServerMessage['t']>(type: T, handler: (message: Extract<ServerMessage, { t: T }>) => void): () => void;
}

/** An input device feeding Manual Drive (M2): keyboard, gamepad, touch (drive feature), phone (phone-drive). */
export interface DriveIntentSource {
  readonly id: DriveSource;
  /** Writes the device's current intent; returns true while it shows deliberate input (beyond dead zones). */
  read(out: DriveIntent): boolean;
}

/** Provided by the `drive` feature: arbitrates sources (most recent deliberate input wins, 1 s hysteresis) and feeds
 * Simulation.drive.setIntent; requests Manual on a fresh deliberate input while in auto or returning. */
export interface DriveService {
  /** Returns the remover (register it with ctx.addDisposer). */
  addSource(source: DriveIntentSource): () => void;
  readonly activeSource: DriveSource | null;
}

export const RENDER = serviceKey<RenderService>('render');
export const CAMERA = serviceKey<CameraService>('camera');
export const ROOM = serviceKey<RoomService>('room');
export const DRIVE = serviceKey<DriveService>('drive');

// ---------------------------------------------------------------- visual builders (contributed via registries)

export interface VisualContext {
  readonly assets: Assets;
  readonly render: RenderService;
}

export interface VehicleVisual {
  /** Added to the scene by `vehicle-view`. */
  readonly root: Object3D;
  /** Pose body and wheels from POSE fields (sim frame -> three via simToThree). Must not allocate. */
  update(t: TelemetryFrame): void;
  /** 0 = opaque body, 1 = fully ghosted (x-ray). */
  setXray(amount: number): void;
  dispose(): void;
}

export interface VehicleVisualDefinition {
  /** Equals VehicleDefinition.visualKey. */
  readonly id: string;
  load(vehicle: VehicleDefinition, ctx: VisualContext): Promise<VehicleVisual>;
}

export interface SuspensionVisual {
  readonly root: Object3D;
  /** Drive parts from CornerFrame.points / springLength (POSE fields). Must not allocate. */
  update(t: TelemetryFrame): void;
  setHighlight(role: ComponentRole, corner: CornerId | 'all', on: boolean): void;
  dispose(): void;
}

export interface SuspensionVisualDefinition {
  /** Equals SuspensionDefinition.visualKey. */
  readonly id: string;
  build(suspension: SuspensionDefinition, vehicle: VehicleDefinition, ctx: VisualContext): SuspensionVisual;
}
