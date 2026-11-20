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
    controls.minDistance = 2.5;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.smoothTime = 0.2;
    controls.draggingSmoothTime = 0.1;
    ctx.addDisposer(() => controls.dispose());
    let exploreHeading = Number.NaN;
    const pivot = new Vector3();
    const explore = (frame: CarFrame, dt: number, out: Pose): boolean => {
      pivot.set(0, PIVOT_Y, 0).applyQuaternion(frame.quat).add(frame.pos);
      if (Number.isNaN(exploreHeading)) {
        // Hand over from wherever the camera is now (research 13 §A4).
        void controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, pivot.x, pivot.y, pivot.z, false);
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

    // Close-up switches x-ray on; leaving restores it unless the user toggled x-ray meanwhile.
    let xrayAuto = false;
    let view = ctx.store.get().view;
    let corner = ctx.store.get().focusCorner;
    rig.setView(view, corner, true);
    if (view === 'closeup' && !ctx.store.get().xray) {
      xrayAuto = true;
      ctx.store.setKey('xray', true);
    }
    ctx.watch((s) => {
      if (s.view !== view || (s.view === 'closeup' && s.focusCorner !== corner)) {
        const entering = s.view === 'closeup' && view !== 'closeup';
        const leaving = s.view !== 'closeup' && view === 'closeup';
        view = s.view;
        corner = s.focusCorner;
        controls.enabled = view === 'explore';
        if (view !== 'explore') exploreHeading = Number.NaN;
        rig.setView(view, corner, instant());
        if (entering && !s.xray) {
          xrayAuto = true;
          ctx.store.setKey('xray', true);
        } else if (leaving && xrayAuto) {
          xrayAuto = false;
          if (s.xray) ctx.store.setKey('xray', false);
        }
        return;
      }
      corner = s.focusCorner;
      if (view === 'closeup' && !s.xray) xrayAuto = false;
    });
    controls.enabled = view === 'explore';

    ctx.on('camera:focus', ({ corner: c }: { corner: CornerId | null }) => {
      ctx.store.setKey('focusCorner', c);
      if (c) ctx.store.setKey('view', 'closeup');
      else if (ctx.store.get().view === 'closeup') ctx.store.setKey('view', 'follow');
    });
    ctx.on('user:activity', () => rig.clearShot(instant()));
    ctx.on('sim:vehicle', () => rig.layout(ctx.sim.frame));

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
