/**
 * buildTrack(def) -> BuiltTrack (ARCHITECTURE §7.2.1): closure solve, dense plan nodes, sections, props,
 * driving line and the analytic surface. All query methods are pure and allocation-free.
 *
 * Lateral offset l is horizontal (perpendicular to the plan heading); the road surface at (s, l) is at
 * xy = centreline + l * left normal, z = roadHeight(s, l). TrackSample.z / grade are the SMOOTH macro elevation
 * (swell + vertical curves) so the body follows the road plane and the ride model sees roughness and features as
 * deviations (ARCHITECTURE §7.6 step 4).
 */
import type { BuiltSection, BuiltTrack, TrackDefinition, TrackProp, TrackSample } from '../../contracts/track';
import { findInterval, wrap, wrapAngle } from '../math/interp';
import { knotOffset } from '../path/path';
import { advancePose, integratePlan, primitiveLength, solveClosure } from './closure';
import { createSurface } from './surface';
import { dcos, dsin } from '../math/det';

export function buildTrack(def: TrackDefinition): BuiltTrack {
  const segments = solveClosure(def);
  const resolved: TrackDefinition = { ...def, segments };
  const plan = integratePlan(segments);
  const length = plan.length;

  let s0 = 0;
  const sections: BuiltSection[] = segments.map((seg, index) => {
    const len = seg.primitives.reduce((a, p) => a + primitiveLength(p), 0);
    const sec = { index, id: seg.id, s0, s1: s0 + len, def: seg };
    s0 += len;
    return sec;
  });
  const bounds = Float64Array.from([...sections.map((sec) => sec.s0), length]);
  const props: TrackProp[] = sections.flatMap((sec) => (sec.def.props ?? []).map((p) => ({ ...p, s: wrap(sec.s0 + p.s, length) })));
  const surface = createSurface(resolved, sections, length);

  const sectionIndexAt = (s: number): number => findInterval(bounds, wrap(s, length));
  const pose = { x: 0, y: 0, psi: 0 };
  const scratch: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };

  const track: BuiltTrack = {
    def: resolved,
    length,
    sections,
    props,
    sectionIndexAt,
    sample(sIn, out) {
      const s = wrap(sIn, length);
      const i = findInterval(plan.s, s);
      const u = s - plan.s[i]!;
      const k = plan.k[i]!;
      const dk = plan.dk[i]!;
      advancePose(plan.x[i]!, plan.y[i]!, plan.psi[i]!, k, dk, u, pose);
      const sec = findInterval(bounds, s);
      out.s = s;
      out.x = pose.x;
      out.y = pose.y;
      out.z = surface.elevation(s, sec);
      out.heading = wrapAngle(pose.psi);
      out.curvature = k + dk * u;
      out.bank = surface.bank(s, sec);
      out.grade = surface.grade(s, sec);
      return out;
    },
    lineOffset(sIn) {
      const s = wrap(sIn, length);
      const sec = sections[findInterval(bounds, s)]!;
      return knotOffset(sec.def.line, s - sec.s0);
    },
    roadHeight(sIn, l) {
      const s = wrap(sIn, length);
      return surface.roadHeight(s, l, findInterval(bounds, s));
    },
    toWorld(s, l, out) {
      track.sample(s, scratch);
      out.x = scratch.x - dsin(scratch.heading) * l;
      out.y = scratch.y + dcos(scratch.heading) * l;
      out.z = track.roadHeight(s, l);
      return out;
    },
  };
  return track;
}
