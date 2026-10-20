// The body: health, warmth, stamina, the flashlight's battery, and fear.
//
// update(dt, env) runs once a frame with what the world says about where you are:
//   { outdoors, blizzard 0..1, wet (bool or 0..1), nearHeat 0..1, running, crouching,
//     flashlightOn, inWater }
// A heated room is nearHeat of about 0.3 throughout; a stove or a heater up close is 1.
//
// Warmth falls outdoors: about six minutes from warm to frozen in the open on a calm night,
// a little over two in the full storm, faster again when wet, half a minute in the sea. Indoors
// it falls slowly unless the room is heated. Heat brings it back. Below 20 the cold starts taking
// health, slowly at first. Getting wet is remembered: you stay wet until a stove or a long time
// indoors dries you out.
//
// Stamina drains while running and comes back after a short rest (more slowly in the cold).
// Run it to zero and you are winded: no running until it is back to 30, so it can't stutter.
// The battery lasts about four minutes of light. Fear rises when callers scare(amount), when you
// are hurt, and eases on its own a little after the last fright; low health keeps a floor under it.
//
// damage(amount, source) and die(cause) end in `dead` and onDeath(cause), where cause is one of
// 'cold' | 'bear' | 'turned' | 'shade' | 'fall' | 'gromov' (anything else passes through as given).
// The HUD polls `hits` and `lastDamage` to pulse its vignette, so onDamage stays free for others.

const FREEZE_OPEN = 6 * 60;          // seconds from 100 to 0 outdoors, calm and dry
const FREEZE_WATER = 30;             // in the sea
const FREEZE_INDOORS = 28 * 60;      // an unheated room
const HEAT_RATE = 7;                 // warmth a second beside a stove (nearHeat 1)
const BATTERY_LIFE = 4 * 60;         // seconds of light per battery
const RUN_DRAIN = 11, STAMINA_BACK = 16, STAMINA_DELAY = 1.0, WINDED_UNTIL = 30;
const FEAR_HOLD = 2.5, FEAR_EASE = 0.07;
const CAUSES = ['cold', 'bear', 'turned', 'shade', 'fall', 'gromov'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Stats {
  constructor() {
    this.onDeath = null;           // (cause) => {}
    this.onDamage = null;          // (amount, source) => {}
    this.onBatteryEmpty = null;    // () => {}
    this.god = false;              // (test harness: no damage, no cold)
    this.reset();
  }

  reset() {
    this.health = 100; this.warmth = 100; this.stamina = 100; this.battery = 100; this.fear = 0;
    this.wet = 0;                  // 0..1, how soaked you are
    this.dead = false; this.cause = null;
    this.winded = false;
    this.hits = 0; this.lastDamage = 0; this.lastSource = null;
    this.warmthRate = 0;           // warmth a second, last frame (the HUD shows rising or falling)
    this._restT = 0; this._fearT = 99; this._batteryWarned = false;
  }

  // the player asks this before running
  get canRun() { return !this.dead && !this.winded && this.stamina > 0; }
  // 0..1: how hard the hands shake (the camera and the weapons read it)
  get shiver() { return clamp((35 - this.warmth) / 35, 0, 1); }
  // 0..1: how far the frost has crept in from the edges of the view
  get frost() { return clamp((60 - this.warmth) / 60, 0, 1); }

  update(dt, env = {}) {
    if (this.dead || !(dt > 0)) return;
    const blizzard = clamp(env.blizzard || 0, 0, 1);
    const heat = clamp(env.nearHeat || 0, 0, 1);

    // wet: the sea soaks you; you dry by a stove, slowly indoors, hardly at all in the open
    if (env.inWater) this.wet = 1;
    else this.wet = Math.max(0, this.wet - dt * (heat > 0 ? 0.02 + 0.25 * heat : env.outdoors ? 0.004 : 0.012));
    const wet = Math.max(this.wet, env.wet === true ? 1 : +env.wet || 0);

    // warmth
    const before = this.warmth;
    let loss;
    if (env.inWater) loss = 100 / FREEZE_WATER;
    else if (env.outdoors) loss = (100 / FREEZE_OPEN) * (1 + 1.6 * blizzard) * (1 + 0.9 * wet);
    else loss = (100 / FREEZE_INDOORS) * (1 + 0.9 * wet);
    if (env.running) loss *= 0.85;                       // moving keeps the blood going
    const gain = env.inWater ? 0 : heat * HEAT_RATE;
    if (!this.god) this.warmth = clamp(this.warmth + (gain - loss * (1 - heat)) * dt, 0, 100);
    this.warmthRate = (this.warmth - before) / dt;

    // the cold takes health below 20 warmth: slowly at first, about a point a second at zero
    if (this.warmth < 20 && !this.god) {
      this.health -= (0.15 + 0.85 * (1 - this.warmth / 20)) * dt;
      if (this.health <= 0) { this.health = 0; this.die('cold'); return; }
    }

    // stamina
    if (env.running && this.canRun) {
      this.stamina = Math.max(0, this.stamina - RUN_DRAIN * dt);
      this._restT = 0;
      if (this.stamina === 0) this.winded = true;
    } else {
      this._restT += dt;
      if (this._restT > STAMINA_DELAY) {
        const cold = this.warmth < 30 ? 0.55 : 1;
        this.stamina = Math.min(100, this.stamina + STAMINA_BACK * cold * (env.crouching ? 1.15 : 1) * dt);
      }
      if (this.winded && this.stamina >= WINDED_UNTIL) this.winded = false;
    }

    // the flashlight's battery
    if (env.flashlightOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - (100 / BATTERY_LIFE) * dt);
      if (this.battery === 0 && !this._batteryWarned) { this._batteryWarned = true; this.onBatteryEmpty?.(); }
    }

    // fear eases after a while, down to the floor that low health keeps under it
    this._fearT += dt;
    const floor = 0.25 * (1 - this.health / 100) + 0.1 * this.shiver;
    if (this._fearT > FEAR_HOLD && this.fear > floor) this.fear = Math.max(floor, this.fear - FEAR_EASE * dt);
    else if (this.fear < floor) this.fear = Math.min(floor, this.fear + 0.05 * dt);
  }

  scare(amount = 0.3) {
    if (this.dead) return;
    this.fear = clamp(this.fear + amount, 0, 1);
    this._fearT = 0;
  }

  calm(amount = 0.2) { this.fear = clamp(this.fear - amount, 0, 1); }

  damage(amount, source = 'unknown') {
    if (this.dead || !(amount > 0) || this.god) return;
    this.health = Math.max(0, this.health - amount);
    this.hits++; this.lastDamage = amount; this.lastSource = source;
    this.scare(Math.min(0.45, 0.1 + amount / 60));
    this.onDamage?.(amount, source);
    if (this.health <= 0) this.die(source);
  }

  heal(n) { if (!this.dead) this.health = Math.min(100, this.health + n); }
  warm(n) { if (!this.dead) this.warmth = Math.min(100, this.warmth + n); }
  refillBattery(n = 100) { this.battery = Math.min(100, this.battery + n); this._batteryWarned = false; }
  tire(n) { this.stamina = Math.max(0, this.stamina - n); this._restT = 0; }

  die(cause = 'unknown') {
    if (this.dead) return;
    this.dead = true; this.health = 0;
    this.cause = CAUSES.includes(cause) ? cause : cause || 'unknown';
    this.onDeath?.(this.cause);
  }

  serialize() {
    const r = (v) => Math.round(v * 10) / 10;
    return { health: r(this.health), warmth: r(this.warmth), stamina: r(this.stamina), battery: r(this.battery), wet: r(this.wet) };
  }

  // a checkpoint gives you back what you had, but never less than enough to go on with
  restore(s) {
    this.reset();
    if (!s) return;
    this.health = clamp(+s.health || 100, 25, 100);
    this.warmth = clamp(+s.warmth || 100, 40, 100);
    this.stamina = clamp(+s.stamina || 100, 0, 100);
    this.battery = clamp(s.battery ?? 100, 0, 100);
    this.wet = clamp(+s.wet || 0, 0, 1);
  }
}
