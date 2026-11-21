import CameraControls from 'camera-controls';
import { Box3, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } from 'three';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { CAMERA, RENDER, type CameraService } from '../../contracts/services';
import type { CornerId } from '../../contracts/units';
import { h, mount } from '../../ui/dom';
import { wrapAngle } from './damp';
import { CameraRig, PIVOT_Y, type CarFrame, type Pose } from './rig';
import './camera.css';

CameraControls.install({ THREE: { Box3, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } });

let frameHandler: ((frame: FrameInfo) => void) | undefined;

/**
 * Poses the renderer's camera (RENDER.camera) every frame: follow / explore / closeup from store.view, director
 * shots from the CAMERA service, smooth blends (fade-cuts under reduced motion).
 */
export default {
  id: 'camera',
  requires: ['renderer'],
  phase: 'camera',
  init(ctx) {
    const render = ctx.services.get(RENDER);
    const camera = render.camera;

    // Explore: camera-controls on a proxy camera; the rig blends its pose like any other source.
    const proxy = new PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    const controls = new CameraControls(proxy, render.renderer.domElement);
    controls.enabled = false;
    // Zoom range per vehicle (set on boot and on every vehicle swap): never inside the body, never a speck.
    const zoomRange = () => {
      const bike = ctx.sim.current.vehicle.class === 'motorcycle';
      controls.minDistance = bike ? 1.6 : 3.4;
      controls.maxDistance = bike ? 9 : 16;
    };
    zoomRange();
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.smoothTime = 0.2;
    controls.draggingSmoothTime = 0.1;
    // Default speeds turn ~180° for a quarter-screen drag; half that reads as orbiting, not spinning.
    controls.azimuthRotateSpeed = 0.5;
    controls.polarRotateSpeed = 0.5;
    ctx.addDisposer(() => controls.dispose());
    let exploreHeading = Number.NaN;
    const pivot = new Vector3();
    const explore = (frame: CarFrame, dt: number, out: Pose): boolean => {
      pivot.set(0, PIVOT_Y, 0).applyQuaternion(frame.quat).add(frame.pos);
      if (Number.isNaN(exploreHeading)) {
        // Hand over from wherever the camera is now (research 13 §A4).
        void controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, pivot.x, pivot.y, pivot.z, false);
        // From a close-up the eye sits at the wheel: back off to a whole-vehicle distance along the same bearing.
        const whole = controls.minDistance * 1.9;
        if (controls.distance < whole) void controls.dollyTo(whole, false);
      } else {
        // The orbit turns with the car, so a 3/4 view stays 3/4 through corners.
        void controls.rotate(wrapAngle(frame.heading - exploreHeading), 0, false);
        void controls.moveTo(pivot.x, pivot.y, pivot.z, false);
      }
      exploreHeading = frame.heading;
      controls.update(dt);
      out.pos.copy(proxy.position);
      out.quat.copy(proxy.quaternion);
      out.fov = 45;
      return true;
    };

    const rig = new CameraRig(() => ctx.sim.current, explore);
    const instant = () => ctx.store.get().reducedMotion;

    // A car's close-up switches x-ray on (and keeps it on: the eye sits at the bumper and looks through the body at
    // the linkage); leaving restores it unless x-ray was already on before entering. A naked bike needs it only for
    // the rear end, where the seat, side panels and battery box hide a monoshock (its x-ray ghosts that bodywork
    // only); the fork close-up keeps the whole bike solid.
    const needsXray = (c: CornerId | null) => ctx.sim.current.vehicle.class !== 'motorcycle' || c === 'r';
    let xrayAuto = false;
    let view = ctx.store.get().view;
    let corner = ctx.store.get().focusCorner;
    const syncXray = () => {
      const on = ctx.store.get().xray;
      if (view === 'closeup' && needsXray(corner)) {
        if (!on) {
          xrayAuto = true;
          ctx.store.setKey('xray', true);
        }
      } else if (xrayAuto) {
        xrayAuto = false;
        if (on) ctx.store.setKey('xray', false);
      }
    };
    rig.setView(view, corner, true);
    syncXray();
    ctx.watch((s) => {
      if (s.view !== view || (s.view === 'closeup' && s.focusCorner !== corner)) {
        view = s.view;
        corner = s.focusCorner;
        controls.enabled = view === 'explore';
        if (view !== 'explore') exploreHeading = Number.NaN;
        rig.setView(view, corner, instant());
      }
      corner = s.focusCorner;
      syncXray();
    });
    controls.enabled = view === 'explore';

    ctx.on('camera:focus', ({ corner: c }: { corner: CornerId | null }) => {
      ctx.store.setKey('focusCorner', c);
      if (c) ctx.store.setKey('view', 'closeup');
      else if (ctx.store.get().view === 'closeup') ctx.store.setKey('view', 'follow');
    });
    ctx.on('user:activity', () => rig.clearShot(instant()));
    ctx.on('sim:vehicle', () => {
      rig.layout(ctx.sim.frame);
      zoomRange();
      syncXray(); // a vehicle swap inside a close-up: x-ray follows the new vehicle's need
    });

    const service: CameraService = {
      playShot: (shot) => rig.playShot(shot, instant()),
      clearShot: () => rig.clearShot(instant()),
      get transitioning() {
        return rig.transitioning;
      },
    };
    ctx.services.provide(CAMERA, service);

    // Dip-from-black for reduced-motion cuts.
    const fade = h('div', { class: 'sl-camera-fade', 'aria-hidden': 'true' });
    ctx.addDisposer(mount(ctx.dom.overlay, fade));
    let shownFade = 0;

    frameHandler = ({ dt, t }) => {
      const pose = rig.update(dt, t);
      camera.position.copy(pose.pos);
      camera.quaternion.copy(pose.quat);
      if (Math.abs(camera.fov - pose.fov) > 1e-4) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      if (proxy.aspect !== camera.aspect) {
        proxy.aspect = camera.aspect;
        proxy.updateProjectionMatrix();
      }
      if (rig.fade !== shownFade) {
        shownFade = rig.fade;
        fade.style.opacity = String(shownFade);
      }
    };
    ctx.addDisposer(() => (frameHandler = undefined));
  },
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
