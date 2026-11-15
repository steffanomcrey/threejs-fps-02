// bots.js — the two crews. Bots walk the waypoint graph, hold angles when they
// have line of sight, react after a human-ish delay, and play the objective:
// the Rustjackal carrier plants the charge, Dockhands defuse it.
import * as THREE from 'three';
import { WAYPOINTS, SITES, SPAWNS, findPath, nearestWaypoint, hasLineOfSight, collideCircle } from './world.js';

const NAMES_US = ['MARA', 'JUNO'];
const NAMES_FOE = ['VEX', 'KODA', 'RUST'];
const COLORS = { us: 0x3fa7a0, foe: 0xd97b2f };

function makeBotMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a37e, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), bodyMat);
  body.position.y = 1.0;
  body.name = 'body';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.y = 1.62;
  head.name = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), darkMat);
  visor.position.set(0, 1.64, 0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.85), darkMat);
  gun.position.set(0.2, 1.15, 0.35);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.3), darkMat);
  legs.position.y = 0.28;
  g.add(body, head, visor, gun, legs);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export class Bot {
  constructor(team, name, spawn, colliders) {
    this.team = team;
    this.name = name;
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.colliders = colliders;
    this.mesh = makeBotMesh(COLORS[team]);
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.traverse((o) => { o.userData.bot = this; });
    this.speed = 3.4;
    this.path = [];
    this.pathIdx = 0;
    this.holdT = 0;
    this.reactionT = 0;
    this.shootCd = 0;
    this.burstLeft = 0;
    this.burstCd = 0;
    this.target = null;
    this.aimYaw = 0;
    this.carrier = false;
    this.actionT = 0; // plant / defuse channel progress
    this.action = null;
    this.wanderT = 0;
  }
  reset(spawn) {
    this.x = spawn.x; this.z = spawn.z;
    this.hp = 100; this.alive = true;
    this.path = []; this.pathIdx = 0;
    this.action = null; this.actionT = 0;
    this.target = null; this.burstLeft = 0;
    this.mesh.visible = true;
    this.mesh.position.set(this.x, 0, this.z);
  }
  die() {
    this.alive = false;
    this.mesh.visible = false;
  }
  damage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    return false;
  }
  setDestination(nodeIdx) {
    const from = nearestWaypoint(this.x, this.z);
    this.path = findPath(from, nodeIdx);
    this.pathIdx = 0;
  }
  step(dt, ctx) {
    if (!this.alive) return;
    const { player, bots, match } = ctx;
    // Pick the nearest visible enemy: the player or an opposing bot.
    let best = null, bestD = Infinity;
    const foes = [];
    if (this.team === 'foe' && player.alive) foes.push({ kind: 'player', x: player.x, z: player.z, ref: player });
    for (const b of bots) if (b.team !== this.team && b.alive) foes.push({ kind: 'bot', x: b.x, z: b.z, ref: b });
    for (const f of foes) {
      const d = Math.hypot(f.x - this.x, f.z - this.z);
      if (d < bestD && hasLineOfSight(this.colliders, this.x, this.z, f.x, f.z)) { best = f; bestD = d; }
    }
    const prevTarget = this.target;
    this.target = best;
    if (best && !prevTarget) this.reactionT = 0.45 + Math.random() * 0.5;

    if (best) {
      // Face the enemy, hold the angle, shoot in bursts after reacting.
      this.aimYaw = Math.atan2(best.x - this.x, best.z - this.z);
      this.yaw += shortestAngle(this.yaw, this.aimYaw) * Math.min(1, dt * 8);
      this.mesh.rotation.y = this.yaw;
      this.mesh.position.set(this.x, 0, this.z);
      if (this.reactionT > 0) {
        this.reactionT -= dt;
      } else {
        // Firing state: runs every frame, bursts of 3-5 shots at 0.13 s
        // intervals with a pause between bursts.
        this.shootCd -= dt;
        if (this.shootCd <= 0 && this.burstLeft <= 0) { this.burstLeft = 3 + Math.floor(Math.random() * 3); this.burstCd = 0; }
        if (this.burstLeft > 0) {
          this.burstCd -= dt;
          if (this.burstCd <= 0) {
            this.burstCd = 0.13;
            this.burstLeft -= 1;
            this.shootCd = 0.9 + Math.random() * 0.5;
            ctx.onBotShot(this, best, bestD);
          }
        }
      }
      this.action = null;
      return;
    }

    // No enemy in sight: work the objective.
    this.reactionT = 0;
    if (this.team === 'foe' && this.carrier && match.charge.state === 'idle') {
      const site = match.charge.site || (Math.random() < 0.5 ? 'A' : 'B');
      match.charge.site = site;
      const s = SITES[site];
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (d < 2.5) {
        this.action = 'plant';
        this.actionT += dt;
        if (this.actionT >= 3) { ctx.onPlanted(this, site); this.action = null; this.actionT = 0; }
        return;
      }
      this.gotoNode(nearestSiteNode(site), dt);
      return;
    }
    if (this.team === 'us' && match.charge.state === 'planted') {
      const d = Math.hypot(match.charge.x - this.x, match.charge.z - this.z);
      if (d < 2.5) {
        this.action = 'defuse';
        this.actionT += dt;
        if (this.actionT >= 3.5) { ctx.onDefused(this); this.action = null; this.actionT = 0; }
        return;
      }
      this.gotoPoint(match.charge.x, match.charge.z, dt);
      return;
    }
    // Otherwise patrol toward the nearest site, then hold a random angle.
    this.action = null;
    this.actionT = 0;
    this.holdT -= dt;
    if (this.path.length === 0 || this.pathIdx >= this.path.length) {
      if (this.holdT <= 0) {
        const site = this.team === 'foe' ? (Math.random() < 0.5 ? 'A' : 'B') : (Math.random() < 0.5 ? 'A' : 'B');
        this.setDestination(nearestSiteNode(site));
        this.holdT = 4 + Math.random() * 4;
      }
      return;
    }
    const node = WAYPOINTS[this.path[this.pathIdx]];
    const d = Math.hypot(node.x - this.x, node.z - this.z);
    if (d < 0.6) { this.pathIdx += 1; return; }
    this.gotoPoint(node.x, node.z, dt);
  }
  gotoPoint(tx, tz, dt) {
    // Sidestepping: if a straight hop is pinned against a box face, walk
    // around it on a perpendicular for a short while instead of pushing.
    if (this.sidestepT > 0) {
      tx = this.sidestepX; tz = this.sidestepZ;
      this.sidestepT -= dt;
    }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const vx = (dx / d) * this.speed, vz = (dz / d) * this.speed;
    const nx = this.x + vx * dt, nz = this.z + vz * dt;
    const res = collideCircle(this.colliders, nx, nz, 0.45);
    const moved = Math.hypot(res.x - this.x, res.z - this.z);
    const intended = Math.hypot(nx - this.x, nz - this.z);
    if (intended > 1e-6 && moved < intended * 0.5) {
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT > 0.8) {
        const px = -dz / d, pz = dx / d;
        const side = (this.stuckSeed = (this.stuckSeed || 0) + 1) % 2 === 0 ? 1 : -1;
        this.sidestepX = this.x + px * side * 3;
        this.sidestepZ = this.z + pz * side * 3;
        this.sidestepT = 0.8;
        this.stuckT = 0;
      }
    } else {
      this.stuckT = 0;
    }
    this.x = res.x; this.z = res.z;
    this.yaw = Math.atan2(vx, vz);
    this.mesh.rotation.y = this.yaw;
    this.mesh.position.set(this.x, 0, this.z);
  }
  gotoNode(nodeIdx, dt) {
    const node = WAYPOINTS[nodeIdx];
    this.gotoPoint(node.x, node.z, dt);
  }
}

function nearestSiteNode(site) {
  const s = SITES[site];
  let best = 0, bd = Infinity;
  WAYPOINTS.forEach((w, i) => {
    const d = (w.x - s.x) ** 2 + (w.z - s.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Squad {
  constructor(scene, colliders) {
    this.colliders = colliders;
    this.bots = [];
    for (let i = 0; i < 2; i++) {
      const b = new Bot('us', NAMES_US[i], SPAWNS.us[i + 1], colliders);
      scene.add(b.mesh);
      this.bots.push(b);
    }
    for (let i = 0; i < 3; i++) {
      const b = new Bot('foe', NAMES_FOE[i], SPAWNS.foe[i], colliders);
      if (i === 0) b.carrier = true;
      scene.add(b.mesh);
      this.bots.push(b);
    }
  }
  resetRound() {
    this.bots.forEach((b, i) => {
      const spawn = b.team === 'us' ? SPAWNS.us[(i % 2) + 1] : SPAWNS.foe[i - 2];
      b.reset(spawn);
      b.carrier = b.team === 'foe' && b.name === 'VEX';
    });
  }
  alive(team) { return this.bots.filter((b) => b.team === team && b.alive); }
  step(dt, ctx) {
    for (const b of this.bots) b.step(dt, ctx);
    // If the carrier falls, the next living Rustjackal picks up the charge.
    if (!this.bots.some((b) => b.team === 'foe' && b.alive && b.carrier)) {
      const next = this.bots.find((b) => b.team === 'foe' && b.alive);
      if (next) next.carrier = true;
    }
  }
}
