import { nearest, posAt, wrapS, heightAt, HALF_WIDTH } from './track.js';

// Arkade-fysikk: bare gass og sving. Trucken har en fartsvektor med litt sidegrep (litt sladd i svingene).
export const MAX_SPEED = 40;
const ACCEL = 24;
const OFFROAD_MAX = 17;
const TURN_RATE = 1.9; // rad/s ved full sving
const GRIP = 5; // hvor raskt sidefarten dør ut
const GRAVITY = 28;
const REVERSE_MAX = 16;
const BRAKE = 45;
const JUMP_SPEED = 14; // topphøyde ≈ 3,5 (var 1,8)

export const COIN_ACCEL = 0.03; // ekstra akselerasjon per mynt
export const COIN_ACCEL_MAX = 0.6;
export const TURBO_TIME = 2.2;
export const SHIELD_TIME = 10;
export const STUN_TIME = 1.4;

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Truck {
  constructor(id) {
    this.id = id;
    this.score = 0;
    this.finished = false;
  }

  // s: avstand langs banen, lat: sideforskyvning, dist: akkumulert distanse (negativ før startstreken).
  place(track, s, lat = 0, dist = s) {
    const p = posAt(track, s, lat);
    this.x = p.x;
    this.z = p.z;
    this.y = 0;
    this.vy = 0;
    this.air = false;
    this.rampVy = 0;
    this.landed = false;
    this.theta = p.theta;
    this.vx = 0;
    this.vz = 0;
    this.roll = 0;
    this.wheelSpin = 0;
    this.hint = p.index;
    this.wrongWay = 0;
    // Effekter
    this.turbo = 0;
    this.shield = 0;
    this.stun = 0;
    this.slick = 0; // olje: lite grep og rykkete styring en kort stund
    this.spin = 0; // kort spinn (én runde) etter å ha blitt truffet bakfra av en annen truck
    this.draft = 0; // 0..1 slipstream
    this.catchup = 0; // 0..1 strikk-effekt for den som ligger bak
    this.msg = '';
    this.msgTimer = 0;
    this.dist = dist;
    this.s = wrapS(track, s);
    this.locate(track, false);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  locate(track, accumulate = true) {
    const n = nearest(track, this.x, this.z, this.hint);
    this.hint = n.index;
    this.lat = n.lat;
    this.onRoad = Math.abs(n.lat) <= HALF_WIDTH;
    this.nearest = n;
    const sNew = n.s + n.along;
    if (accumulate) {
      let ds = sNew - this.s;
      ds -= Math.round(ds / track.length) * track.length;
      this.dist += ds;
    }
    this.s = wrapS(track, sNew);
    return n;
  }

  say(text, time = 1.6) {
    this.msg = text;
    this.msgTimer = time;
  }

  step(input, dt, track, locked = false) {
    this.turbo = Math.max(0, this.turbo - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.slick = Math.max(0, this.slick - dt);
    this.spin = Math.max(0, this.spin - dt);
    this.msgTimer = Math.max(0, this.msgTimer - dt);
    this.landed = false;
    this.jumped = false;

    const stunned = this.stun > 0 || this.spin > 0;
    const throttle = locked || stunned || input.brake > 0 ? 0 : Math.max(this.turbo > 0 ? 1 : 0, Math.min(1, Math.max(0, input.throttle)));
    const brake = locked || stunned ? 0 : Math.max(0, Math.min(1, input.brake || 0));
    const jump = !locked && !stunned && !!input.jump;
    const steer = locked || stunned ? 0 : Math.max(-1, Math.min(1, input.steer + (this.slick > 0 ? Math.sin(this.slick * 14) * 0.5 : 0)));
    const fx = Math.cos(this.theta), fz = Math.sin(this.theta);
    const sx = -fz, sz = fx;
    let vf = this.vx * fx + this.vz * fz;
    let vs = this.vx * sx + this.vz * sz;

    const air = this.air;
    // Slipstream og strikk gir litt ekstra topp- og akselerasjon; turbo gir mye.
    const maxMul = 1 + (this.turbo > 0 ? 0.45 : 0) + 0.16 * this.draft + 0.1 * this.catchup;
    // Hver mynt gir litt bedre akselerasjon (opptil +60 %).
    const coinMul = Math.min(COIN_ACCEL_MAX, this.score * COIN_ACCEL);
    const accMul = 1 + (this.turbo > 0 ? 1.4 : 0) + 0.6 * this.draft + 0.5 * this.catchup + coinMul;
    const max = (this.onRoad ? MAX_SPEED : OFFROAD_MAX) * (0.35 + 0.65 * throttle) * maxMul;
    if (!air) {
      if (vf < max) vf = Math.min(max, vf + ACCEL * accMul * throttle * dt);
      else vf -= (vf - max) * (this.onRoad ? 1.2 : 3) * dt;
      vf -= vf * (throttle > 0 ? 0.12 : 0.7) * dt; // rullemotstand, mer uten gass
      if (brake > 0) {
        // Brems mens trucken ruller framover, deretter rygging.
        if (vf > 0.5) vf = Math.max(0, vf - BRAKE * brake * dt);
        else vf = Math.max(-REVERSE_MAX * (this.onRoad ? 1 : 0.6), vf - ACCEL * 0.9 * brake * dt);
      }
      if (stunned) vf *= Math.exp(-2.4 * dt);
    }
    if (jump && !air) {
      this.air = true;
      this.vy = JUMP_SPEED;
      this.jumped = true;
    }
    vs *= Math.exp(-GRIP * (air || this.slick > 0 ? 0.1 : 1) * dt);

    const speedFrac = Math.min(1, Math.abs(vf) / MAX_SPEED);
    let turn = steer * TURN_RATE * Math.min(1, Math.abs(vf) / 8) * (1 - 0.35 * Math.min(1, speedFrac));
    if (air) turn *= 0.4;
    this.theta += turn * dt * Math.sign(vf || 1);
    if (stunned) this.theta += 9 * dt; // trucken spinner rundt

    // Fartsvektoren roteres med trucken: behold sidefarten fra før rotasjonen.
    const nfx = Math.cos(this.theta), nfz = Math.sin(this.theta);
    if (stunned) {
      // Sladd: fartsvektoren følger ikke den spinnende nesen.
      this.vx = fx * vf - fz * vs;
      this.vz = fz * vf + fx * vs;
    } else {
      this.vx = nfx * vf - nfz * vs;
      this.vz = nfz * vf + nfx * vs;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    const n = this.locate(track);

    // Barriere: skyv tilbake, fjern farten utover og drei trucken mot banens retning så den aldri setter seg fast.
    if (Math.abs(n.lat) > track.wallLat) {
      const side = Math.sign(n.lat);
      const over = Math.abs(n.lat) - track.wallLat;
      this.x -= n.nx * over * side;
      this.z -= n.nz * over * side;
      const out = (this.vx * n.nx + this.vz * n.nz) * side;
      if (out > 0) { this.vx -= n.nx * out * side; this.vz -= n.nz * out * side; }
      this.vx *= 1 - 1.5 * dt;
      this.vz *= 1 - 1.5 * dt;
      if (!stunned && vf > -1) this.theta += angleDiff(Math.atan2(n.tz, n.tx), this.theta) * 2.2 * dt;
      this.lat = side * track.wallLat;
      this.hitWall = true;
    } else this.hitWall = false;

    // Høyde: ramper, og fritt fall etter et hopp.
    const h = heightAt(track, this.s, this.lat);
    if (!this.air) {
      if (h < this.y - 0.2 && this.rampVy > 2) {
        this.air = true;
        this.vy = this.rampVy;
      } else {
        const rise = (h - this.y) / dt;
        this.rampVy = rise > 0 ? rise : this.rampVy * 0.9;
        this.y = h;
      }
    }
    if (this.air) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= h) {
        this.y = h;
        this.vy = 0;
        this.air = false;
        this.rampVy = 0;
        this.landed = true;
      }
    }

    // Feil vei: kjører mot banens retning.
    const along = this.vx * n.tx + this.vz * n.tz;
    if (along < -3) this.wrongWay += dt; else this.wrongWay = 0;

    this.roll += (-steer * speedFrac * 0.12 - this.roll) * Math.min(1, 8 * dt);
    this.wheelSpin += vf * dt / 1.1;
  }
}
