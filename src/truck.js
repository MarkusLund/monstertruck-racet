import { Vec2, Box, Circle, Polygon, WheelJoint } from 'planck';

export const CAT_GROUND = 0x0001;
export const CAT_TRUCK = 0x0002;

// Trucks only collide with the ground, never with each other.
const truckFilter = { filterCategoryBits: CAT_TRUCK, filterMaskBits: CAT_GROUND };

export const TRUCK = {
  wheelRadius: 0.72,
  wheelOffsetX: 1.3,
  wheelOffsetY: -0.8,
  maxWheelSpeed: 34, // rad/s forward
  maxReverseSpeed: 16,
  motorTorque: 42, // per wheel
  brakeTorque: 30,
  airTorque: 14,
  jumpVelocity: 5.5, // m/s added upwards (modest hop, keeps momentum)
  jumpCooldown: 0.45,
};

export class Truck {
  constructor(world, id, x, y) {
    this.id = id;
    this.world = world;
    this.score = 0;
    this.finished = false;
    this.jumpTimer = 0;
    this.flipTimer = 0;
    this.airTime = 0;
    this.respawns = 0;
    this.maxX = x;

    const chassis = world.createBody({ type: 'dynamic', position: Vec2(x, y), angularDamping: 0.6 });
    chassis.createFixture({ shape: new Box(1.75, 0.32), density: 2.2, friction: 0.4, ...truckFilter });
    chassis.createFixture({
      shape: new Polygon([Vec2(-0.7, 0.3), Vec2(0.75, 0.3), Vec2(0.45, 1.0), Vec2(-0.55, 1.0)]),
      density: 0.4, friction: 0.4, ...truckFilter,
    });
    // Low ballast keeps the center of mass down so the truck is not too tippy.
    chassis.createFixture({ shape: new Circle(Vec2(0, -0.35), 0.3), density: 9, friction: 0.2, ...truckFilter });
    this.chassis = chassis;

    this.wheels = [];
    this.joints = [];
    for (const side of [-1, 1]) {
      const wp = Vec2(x + side * TRUCK.wheelOffsetX, y + TRUCK.wheelOffsetY);
      const wheel = world.createBody({ type: 'dynamic', position: wp, angularDamping: 0.3 });
      wheel.createFixture({ shape: new Circle(TRUCK.wheelRadius), density: 1.1, friction: 1.6, restitution: 0.05, ...truckFilter });
      const joint = world.createJoint(new WheelJoint({
        enableMotor: true, motorSpeed: 0, maxMotorTorque: 1,
        frequencyHz: 4.2, dampingRatio: 0.65,
      }, chassis, wheel, wp, Vec2(0, 1)));
      this.wheels.push(wheel);
      this.joints.push(joint);
    }
    this.bodies = [chassis, ...this.wheels];
  }

  get x() { return this.chassis.getPosition().x; }
  get y() { return this.chassis.getPosition().y; }
  get angle() { return this.chassis.getAngle(); }

  touchesGround(body) {
    for (let ce = body.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching() && ce.other.getUserData() === 'ground') return true;
    }
    return false;
  }

  get grounded() { return this.wheels.some((w) => this.touchesGround(w)); }

  control(input, dt, locked) {
    const t = locked ? 0 : Math.max(-1, Math.min(1, input.throttle));
    const grounded = this.grounded;
    // Forward speed along the truck (positive = driving right).
    const fwd = -this.wheels.reduce((a, w) => a + w.getAngularVelocity(), 0) / 2 * TRUCK.wheelRadius;
    const braking = (t < -0.02 && fwd > 1.5) || (t > 0.02 && fwd < -1.5);
    for (const j of this.joints) {
      if (braking) {
        // Pressing the opposite pedal brakes first, then drives the other way.
        j.setMotorSpeed(0);
        j.setMaxMotorTorque(TRUCK.brakeTorque * Math.abs(t));
      } else if (Math.abs(t) > 0.02) {
        j.setMotorSpeed(t > 0 ? -TRUCK.maxWheelSpeed * t : -TRUCK.maxReverseSpeed * t);
        j.setMaxMotorTorque(TRUCK.motorTorque * (0.35 + 0.65 * Math.abs(t)));
      } else {
        j.setMotorSpeed(0);
        j.setMaxMotorTorque(locked ? 60 : 2.5); // rolling resistance when coasting
      }
    }
    this.jumpTimer -= dt;
    if (grounded) this.airTime = 0; else this.airTime += dt;
    // Air control like Hill Climb Racing: gas tilts nose up, reverse tilts nose down.
    if (!grounded && !locked) this.chassis.applyTorque(t * TRUCK.airTorque, true);

    if (!locked && input.jump && grounded && this.jumpTimer <= 0) {
      this.jumpTimer = TRUCK.jumpCooldown;
      for (const b of this.bodies) {
        const v = b.getLinearVelocity();
        b.setLinearVelocity(Vec2(v.x, Math.max(v.y, 0) + TRUCK.jumpVelocity));
      }
    }
  }

  // Place the truck upright on the ground at (x, groundY), at rest.
  place(x, groundY, angle = 0) {
    const h = -TRUCK.wheelOffsetY + TRUCK.wheelRadius + 0.05;
    const c = Vec2(x - Math.sin(angle) * h, groundY + Math.cos(angle) * h);
    this.chassis.setTransform(c, angle);
    [-1, 1].forEach((side, i) => {
      const lx = side * TRUCK.wheelOffsetX, ly = TRUCK.wheelOffsetY;
      const wx = c.x + lx * Math.cos(angle) - ly * Math.sin(angle);
      const wy = c.y + lx * Math.sin(angle) + ly * Math.cos(angle);
      this.wheels[i].setTransform(Vec2(wx, wy), 0);
    });
    for (const b of this.bodies) {
      b.setLinearVelocity(Vec2(0, 0));
      b.setAngularVelocity(0);
      b.setAwake(true);
    }
    this.flipTimer = 0;
    this.airTime = 0;
  }

  speed() { return this.chassis.getLinearVelocity().length(); }
}
