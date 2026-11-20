/**
 * Grounding cards for the Race Engineer prompt (ARCHITECTURE §12.5 step 2). Curated from research 04 §1-§11 and
 * checked against what THIS simulation measures (02-02 kinematics report, 02-04 difference report).
 * RULES: no digits (numbers come only from telemetry; tests assert it); tendencies are worded as such; every card
 * says what the model does not capture. Research estimates ([E]) are never stated as data.
 */

export const COMMON_CAR = `The car is a self-driving GT coupe with representative parameters, not the data of any real car. It laps a test loop on a fixed path at the same speed whatever the suspension.
All three suspension types share the same springs, dampers, anti-roll bars, tyres and ride frequencies, so differences come only from the linkage geometry, plus a little extra damper friction for the strut.
Signs: negative camber means the top of the wheel leans toward the car; camber_deg is measured to the road. travel_mm is positive in bump (wheel pushed up, spring compressed). In a right-hand corner lat_g is negative, the body leans to the left and the left wheels are the outside, loaded wheels; in a left-hand corner it is the opposite. roll_deg is positive when the left side is up. pitch_deg is positive nose down. Corners: fl front-left, fr front-right, rl rear-left, rr rear-right.
grip_use is a simplified tyre-model estimate of how much of the available grip a tyre uses (around one means at the limit), not a measurement.
Derived values: roll_centre_front_mm and roll_centre_rear_mm are the live kinematic roll-centre heights; camber_gain_front_deg_per_cm and camber_gain_rear_deg_per_cm are camber change relative to the body per centimetre of bump at design height; roll_camber_front and roll_camber_rear are how much the wheel leans with the body per degree of roll (one means it leans fully with the body, zero means it stays upright to the road); anti_dive_front_pct and anti_squat_rear_pct are the side-view anti-pitch percentages.
Physics: in a corner, load moves to the outside tyres. The roll centre splits that load transfer: the part carried through the links does not roll the body, the part carried by springs and bars does. A higher roll centre gives slightly less roll but more jacking and more sideways movement of the roll centre.
The outside wheel's camber to the road is roughly its static camber, plus the camber the linkage adds in bump, plus the body roll. A linkage that adds negative camber in bump counters the roll and keeps the tyre flatter.
Steering also changes camber: with caster, the outside front wheel gains negative camber as it steers, so at the front the steering geometry matters as much as the linkage.
In this simulation the three types differ visibly in roll-centre height and in outside-rear camber in long corners. Differences in outside-front camber are small, and differences in body roll, brake pitch, bump steer and grip use are tiny. The screen can amplify motion (it says so when it does); numbers are always true scale.
Not modelled: bushing compliance and flexing parts (all links are rigid), tyre temperature, wear and pressure, aerodynamic downforce, the extra vertical load from the banking in the carousel, and rear anti-lift under braking.
No suspension type is best overall; each trades cost, packaging and wheel control.`;

export const COMMON_MOTORCYCLE = `The motorcycle is a self-driving cafe racer with representative parameters, not the data of any real bike. It leans into corners; roll_deg is its lean angle. Corners: f front, r rear.
Typical tendencies: a telescopic fork compresses under braking, so the front dives and the steering geometry tightens; a Telelever front separates braking forces from the spring, so it dives much less; a linkage rear suspension usually stiffens progressively deeper into its travel; a twin-shock rear is simpler and lighter in parts.
Not modelled: frame and fork flex, tyre temperature and wear, rider body movement and aerodynamics.
No layout is best overall; each trades cost, weight, feel and control.`;

/** Per suspension id. Cards for ids without an entry fall back to the common card only. */
export const SUSPENSION_FACTS: Readonly<Record<string, string>> = {
  macpherson: `ACTIVE SUSPENSION: MacPherson strut. A lower arm plus a strut whose damper body is a structural part that slides through a top mount; the steering axis runs from the lower ball joint to the top mount.
It adds the least camber in bump of the three types here, so in roll the wheels lean almost as much as the body.
It has the highest roll centre of the three here, and that roll centre moves a long way as the car rolls and heaves.
In this simulation the strut front has the most caster, so steering adds negative camber to the outside front wheel; in the carousel that offsets its weak camber gain, and its outside front ends up close to the multi-link. Its rear, which does not steer, loses clearly the most outside camber of the three in long corners.
Side load on the strut adds friction, which typically makes small bumps a little harsher; in this simulation the effect is small.
Its side-view geometry gives it the most anti-dive here, but brake pitch differs only a tiny amount between the types.
Strengths: typically the fewest parts, the lowest cost, compact across the car (room for the engine), light. Costs: a tall tower that raises the bonnet line, limited camber control, and it is harder to combine wide tyres with a small scrub radius.`,
  'double-wishbone': `ACTIVE SUSPENSION: double wishbone. Two arms of unequal length (the upper one shorter) hold the upright; the steering axis runs between the two ball joints, independent of the spring and damper.
It adds the most negative camber in bump of the three types here: as the body rolls it pulls the top of the outside wheel inward, so the tyre stays the flattest. The gain over the others is clearest at the rear in long corners; at the front, at true scale, it is small.
Its roll centre is in the middle of the three here and moves sideways the least as the body rolls.
The spring and damper work in line with the motion, so friction is low.
Strengths: typically the best camber control and a low bonnet line. Costs: more parts and cost, a wider package, and more sideways scrub of the tyre over bumps as camber gain rises.`,
  multilink: `ACTIVE SUSPENSION: multi-link. Here five separate rods locate each wheel, and the steering axis is a virtual one defined by the links.
Its camber gain in bump and its camber recovery in roll lie between the strut and the double wishbone here.
It has the lowest roll centre of the three here, so slightly more of the load transfer goes through the springs and the body rolls a tiny bit more. In this layout its roll centre still moves a long way sideways as the body rolls.
Its main real-world advantage is control of toe and camber under cornering and braking forces through deliberately designed bushing compliance. This simulation uses rigid links, so that advantage is not modelled and does not show; all three types were tuned to almost no bump steer.
Strengths: typically the most freedom to tune camber, toe and anti-dive or anti-squat independently, and good isolation. Costs: the most parts, cost and tuning effort.`,
};

export function factsFor(vehicleClass: string, suspension: string): string {
  const common = vehicleClass === 'motorcycle' ? COMMON_MOTORCYCLE : COMMON_CAR;
  const card = SUSPENSION_FACTS[suspension];
  return card ? `${common}\n${card}` : common;
}
