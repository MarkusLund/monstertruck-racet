import { nearest, posAt, wrapS, heightAt, HALF_WIDTH, WALL_LAT } from './track.js';
import { groundHeight, groundSlope, terrainLevels } from './terrain.js';
import { fenceAt, FENCE_LAT, FENCE_BAND } from './fences.js';

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
const SLOPE_ACCEL = 14; // tyngdekraft langs bakken: litt tregere opp, litt raskere ned
const STATIC_GRIP = 1.5; // en truck som står stille uten gass blir stående i slakere bakker enn dette (m/s²)
const FALL_OFF = 0.3; // faller bakken mer enn dette på ett steg, letter trucken (kjører utfor en kant)

// Utenfor veien: gresskanten (opp til WALL_LAT) er fri, lenger ute går klokka, og etter en stund blir man hentet tilbake.
export const OFF_GRACE = 2.5; // sekunder ute i terrenget før man hentes
const FAR_LAT = WALL_LAT + 55; // så langt ute hentes man med en gang
const MAX_STEP_DS = 25; // hopper nærmeste banepunkt mer enn dette på ett steg, har man skåret over til en annen del av banen
export const RESCUE_TIME = 1.4; // hele redningen: trucken forsvinner, flyttes og dukker opp igjen (styringen er låst)
export const RESCUE_SWAP = 0.6; // når redningsklokka passerer dette flyttes trucken tilbake på veien
export const BLAST_TIME = 2; // redning etter rakettreff: trucken er sprengt i filler en stund før den dukker opp igjen

export const COIN_ACCEL = 0.03; // ekstra akselerasjon per mynt
export const COIN_ACCEL_MAX = 0.6;
export const TURBO_TIME = 2.2;
export const SHIELD_TIME = 10;
export const STUN_TIME = 1.4;
// Drift-boost: sladd (full styring i fart + gass) bygger ladning (sekunder); ved utgang får trucken turbo.
const DRIFT_MIN_SPEED = 20;
const DRIFT_MIN_STEER = 0.55;
const DRIFT_GRACE = 0.2; // hvor lenge driften tåler et glipp før den regnes som avsluttet
export const DRIFT_TIERS = [0.7, 1.5, 2.5]; // ladning for gul, oransje og blå
const DRIFT_MAX = 3;
const DRIFT_BOOST_MAX = 1.2;
export const driftTier = (charge) => DRIFT_TIERS.filter((x) => charge >= x).length;

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
    this.y = groundHeight(p.x, p.z); // y er absolutt høyde: terreng + hoppehøyde
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
    this.offTime = 0;
    this.rescue = 0;
    this.rescued = null;
    this.rescueWhy = '';
    this.skipped = false;
    this.safeS = s; // siste trygge punkt på veien (dit man hentes tilbake)
    this.safeLat = lat;
    this.safeDist = dist;
    // Effekter
    this.turbo = 0;
    this.shield = 0;
    this.stun = 0;
    this.slick = 0; // olje: lite grep og rykkete styring en kort stund
    this.spin = 0; // kort spinn (én runde) etter å ha blitt truffet bakfra av en annen truck
    this.drift = 0; // drift-ladning i sekunder
    this.driftGap = 0;
    this.driftDir = 0;
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
      if (Math.abs(ds) > MAX_STEP_DS) this.skipped = true; // skar over til en annen del av banen: teller ikke
      else this.dist += ds;
    }
    this.s = wrapS(track, sNew);
    return n;
  }

  say(text, time = 1.6) {
    this.msg = text;
    this.msgTimer = time;
  }

  // Bygger drift-ladning mens man tar en sving med full styring i fart; ved avslutning (eller retningsskifte)
  // gir ladningen turbo proporsjonalt.
  updateDrift(dt, steer, throttle, stunned) {
    const drifting = !this.air && !stunned && this.speed > DRIFT_MIN_SPEED && Math.abs(steer) > DRIFT_MIN_STEER && throttle > 0;
    const dir = Math.sign(steer);
    if (drifting && (!this.driftDir || dir === this.driftDir)) {
      this.driftDir = dir;
      this.drift = Math.min(DRIFT_MAX, this.drift + dt);
      this.driftGap = DRIFT_GRACE;
    } else if (this.drift > 0 && (drifting || (this.driftGap -= dt) <= 0)) {
      if (!this.air && !stunned && this.drift >= DRIFT_TIERS[0]) {
        this.turbo = Math.max(this.turbo, Math.min(DRIFT_BOOST_MAX, 0.4 + 0.8 * (this.drift / DRIFT_TIERS[2])));
        this.say('DRIFT-BOOST!');
      }
      this.drift = 0;
      this.driftDir = 0;
    } else if (this.drift === 0) this.driftDir = 0;
  }

  // Flytter trucken tilbake til siste trygge punkt på veien, stående i kjøreretningen (aldri midt på en rampe).
  respawn(track) {
    let s = this.safeS, dist = this.safeDist;
    for (const j of track.jumps) {
      const w = wrapS(track, s);
      if (w > j.s0 - 8 && w < j.s1 + 6) { dist -= w - (j.s0 - 8); s = j.s0 - 8; }
    }
    const lat = Math.max(-(HALF_WIDTH - 3), Math.min(HALF_WIDTH - 3, this.safeLat));
    const p = posAt(track, s, lat);
    this.x = p.x;
    this.z = p.z;
    this.y = groundHeight(p.x, p.z);
    this.theta = p.theta;
    this.vx = this.vz = this.vy = this.rampVy = 0;
    this.air = false;
    this.drift = this.driftGap = this.driftDir = 0;
    this.stun = this.spin = this.slick = 0;
    this.hint = p.index;
    this.dist = dist;
    this.s = wrapS(track, s);
    this.locate(track, false);
    this.offTime = 0;
    this.skipped = false;
  }

  // Starter en redning (hvis ingen pågår). why: 'off' (utenfor veien), 'water' (i fjorden) eller 'rocket' (sprengt).
  startRescue(why) {
    if (this.rescue > 0) return;
    this.rescue = why === 'rocket' ? BLAST_TIME : RESCUE_TIME;
    this.rescued = why;
    this.rescueWhy = why;
    this.say(why === 'water' ? 'Plask! Tilbake til veien' : why === 'rocket' ? 'BOOM! Truffet av rakett' : 'Tilbake til veien', this.rescue);
  }

  step(input, dt, track, locked = false) {
    this.rescued = null;
    if (this.rescue > 0) {
      const before = this.rescue;
      this.rescue = Math.max(0, this.rescue - dt);
      if (before > RESCUE_SWAP && this.rescue <= RESCUE_SWAP) this.respawn(track);
      locked = true;
    }
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
      const slopeAcc = groundSlope(this.x, this.z, this.theta).forward * SLOPE_ACCEL;
      if (throttle > 0 || Math.abs(vf) > 0.5 || Math.abs(slopeAcc) > STATIC_GRIP) vf -= slopeAcc * dt;
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
    this.updateDrift(dt, steer, throttle, stunned);
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

    const prevLat = this.lat;
    const n = this.locate(track);

    // Gjerder: stopper trucken fra begge sider (rundt endene og over i et hopp kommer man forbi). Innenfra skyves den
    // tilbake, mister farten utover og dreies mot banens retning så den aldri setter seg fast.
    const a = Math.abs(n.lat);
    this.hitWall = false;
    if (a > FENCE_LAT && a < FENCE_LAT + FENCE_BAND && fenceAt(track, n.index, n.lat) && this.y - groundHeight(this.x, this.z) < 1.2) {
      const side = Math.sign(n.lat);
      const inside = Math.abs(prevLat) < FENCE_LAT + FENCE_BAND / 2;
      const target = inside ? FENCE_LAT : FENCE_LAT + FENCE_BAND;
      const move = (a - target) * side;
      this.x -= n.nx * move;
      this.z -= n.nz * move;
      const out = (this.vx * n.nx + this.vz * n.nz) * side * (inside ? 1 : -1);
      if (out > 0) { this.vx -= n.nx * out * side * (inside ? 1 : -1); this.vz -= n.nz * out * side * (inside ? 1 : -1); }
      this.vx *= 1 - 1.5 * dt;
      this.vz *= 1 - 1.5 * dt;
      if (inside && !stunned && vf > -1) this.theta += angleDiff(Math.atan2(n.tz, n.tx), this.theta) * 2.2 * dt;
      this.lat = side * target;
      this.hitWall = true;
    }

    // Høyde: terreng og ramper, og fritt fall etter et hopp (eller når bakken faller bort under en kolle).
    const h = groundHeight(this.x, this.z) + heightAt(track, this.s, this.lat);
    if (!this.air) {
      const ballistic = this.y + this.rampVy * dt - 0.5 * GRAVITY * dt * dt;
      if (h < ballistic - 0.02 && this.rampVy > 2) {
        this.air = true;
        this.vy = this.rampVy;
      } else if (h < this.y - FALL_OFF) {
        this.air = true; // bakken forsvinner under hjulene: utfor stupet
        this.vy = 0;
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

    // Utenfor veien: husk siste trygge punkt, og hent trucken tilbake hvis den er for lenge eller for langt ute,
    // havner i fjorden eller skjærer over til en annen del av banen.
    const lat = Math.abs(this.lat);
    if (!this.air && lat <= HALF_WIDTH && !this.rescue && heightAt(track, this.s, this.lat) === 0) {
      this.safeS = this.s;
      this.safeLat = this.lat;
      this.safeDist = this.dist;
    }
    this.offTime = lat > WALL_LAT && !this.rescue ? this.offTime + dt : 0;
    if (!locked) {
      if (this.y < terrainLevels().water + 0.3) this.startRescue('water');
      else if (lat > FAR_LAT || (this.skipped && lat > HALF_WIDTH) || this.offTime > OFF_GRACE) this.startRescue('off');
      else if (this.offTime > 0.3 && (this.msgTimer <= 0 || this.msg.startsWith('Utenfor'))) this.say(`Utenfor veien! ${Math.ceil(OFF_GRACE - this.offTime)}`, 0.3);
    }
    this.skipped = false;

    // Feil vei: kjører mot banens retning.
    const along = this.vx * n.tx + this.vz * n.tz;
    if (along < -3) this.wrongWay += dt; else this.wrongWay = 0;

    this.roll += (-steer * speedFrac * 0.12 - this.roll) * Math.min(1, 8 * dt);
    this.wheelSpin += vf * dt / 1.1;
  }
}
