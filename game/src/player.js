// player.js — the first-person controller: acceleration-based movement,
// crouching, walking, and AABB collision against the map. Yaw/pitch live here;
// the camera is posed by main.js each frame.
import { collideCircle } from './world.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;

export class Player {
  constructor(colliders) {
    this.colliders = colliders;
    this.x = -28;
    this.z = 18;
    this.yaw = Math.PI; // facing north into the yard (spawn faces the map)
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.crouched = false;
    this.eye = EYE_STAND;
    this.moving = false;
    this.walkQuiet = false;
  }
  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.vx = 0; this.vz = 0;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.crouched = false; this.eye = EYE_STAND;
  }
  damage(amount) {
    if (!this.alive) return;
    const absorbed = Math.min(this.armor, amount * 0.5);
    this.armor -= absorbed;
    this.hp -= (amount - absorbed);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }
  step(dt, keys) {
    if (!this.alive) return;
    const crouch = keys.has('ControlLeft') || keys.has('KeyC');
    this.crouched = crouch;
    this.walkQuiet = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);

    // Wish direction in world space from yaw.
    let fx = 0, fz = 0;
    if (keys.has('KeyW')) { fx += -Math.sin(this.yaw); fz += -Math.cos(this.yaw); }
    if (keys.has('KeyS')) { fx += Math.sin(this.yaw); fz += Math.cos(this.yaw); }
    if (keys.has('KeyA')) { fx += -Math.cos(this.yaw); fz += Math.sin(this.yaw); }
    if (keys.has('KeyD')) { fx += Math.cos(this.yaw); fz += -Math.sin(this.yaw); }
    const len = Math.hypot(fx, fz);
    this.moving = len > 0;
    if (len > 0) { fx /= len; fz /= len; }
    const maxSpeed = crouch ? 2.2 : this.walkQuiet ? 2.6 : 5.2;
    const accel = 34;
    this.vx += fx * accel * dt;
    this.vz += fz * accel * dt;
    // Friction: exponential decay toward the wish velocity.
    const damp = Math.exp(-dt * 9);
    this.vx *= damp;
    this.vz *= damp;
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > maxSpeed) { this.vx *= maxSpeed / sp; this.vz *= maxSpeed / sp; }
    const res = collideCircle(this.colliders, this.x + this.vx * dt, this.z + this.vz * dt, RADIUS);
    // If the wall stopped us, kill the velocity into it.
    if (Math.abs(res.x - (this.x + this.vx * dt)) > 0.001) this.vx = 0;
    if (Math.abs(res.z - (this.z + this.vz * dt)) > 0.001) this.vz = 0;
    this.x = res.x;
    this.z = res.z;
  }
}
