// world.js — Rustline Terminal: a dusk container yard with three lanes, two charge
// sites and a warehouse. Boxes are the single source of truth for both the meshes
// and the AABB colliders; the waypoint graph rides on the same layout.
import * as THREE from 'three';

export const MAP = { halfX: 34, halfZ: 24, wallH: 5 };

// Each box: centre x/z, footprint w/d, height h, colour, optional tag.
const BOXES = [
  // Perimeter walls (gaps left at the two spawns are closed by spawn walls below).
  { x: 0, z: -24, w: 70, d: 1.2, h: 5, c: 0x2e3440, tag: 'wall' },
  { x: 0, z: 24, w: 70, d: 1.2, h: 5, c: 0x2e3440, tag: 'wall' },
  { x: -34, z: 0, w: 1.2, d: 50, h: 5, c: 0x2e3440, tag: 'wall' },
  { x: 34, z: 0, w: 1.2, d: 50, h: 5, c: 0x2e3440, tag: 'wall' },
  // Site A warehouse (north-west): two long walls with a door gap, roof beams.
  { x: -26, z: -16, w: 16, d: 1, h: 6, c: 0x4a4238, tag: 'siteA' },
  { x: -33.4, z: -12, w: 1, d: 9, h: 6, c: 0x4a4238, tag: 'siteA' },
  { x: -19, z: -8.5, w: 1, d: 8, h: 6, c: 0x4a4238, tag: 'siteA' },
  { x: -26, z: -8, w: 9, d: 1, h: 6, c: 0x4a4238, tag: 'siteA' },
  // Site B container stack (south-east): tall rust stack forming a corner.
  { x: 26, z: 17, w: 12, d: 2.6, h: 5.2, c: 0x8a4a26, tag: 'siteB' },
  { x: 31.5, z: 12, w: 2.6, d: 12, h: 5.2, c: 0x8a4a26, tag: 'siteB' },
  { x: 26, z: 14.6, w: 12, d: 2.6, h: 2.6, c: 0xb05a28, tag: 'siteB' },
  // Mid yard: crate clusters and container rows that make the three lanes.
  { x: -8, z: -4, w: 6, d: 2.6, h: 2.6, c: 0x7a5c33, tag: 'mid' },
  { x: -8, z: -1.4, w: 6, d: 2.6, h: 2.6, c: 0x9c6b2e, tag: 'mid' },
  { x: 2, z: 6, w: 2.6, d: 6, h: 2.6, c: 0x3f6d6a, tag: 'mid' },
  { x: 5, z: 6, w: 2.6, d: 6, h: 5.2, c: 0x2f5d5a, tag: 'mid' },
  { x: 12, z: -8, w: 6, d: 2.6, h: 2.6, c: 0x8a4a26, tag: 'mid' },
  { x: 12, z: -5.4, w: 6, d: 2.6, h: 2.6, c: 0x6e3f22, tag: 'mid' },
  { x: -16, z: 8, w: 2.6, d: 6, h: 2.6, c: 0x3f6d6a, tag: 'mid' },
  { x: -13, z: 8, w: 2.6, d: 6, h: 5.2, c: 0x2f5d5a, tag: 'mid' },
  { x: 20, z: 2, w: 2.6, d: 6, h: 2.6, c: 0x7a5c33, tag: 'mid' },
  { x: -2, z: -14, w: 6, d: 2.6, h: 2.6, c: 0x9c6b2e, tag: 'mid' },
  { x: -2, z: -11.4, w: 6, d: 2.6, h: 2.6, c: 0x7a5c33, tag: 'mid' },
  { x: 22, z: -16, w: 2.6, d: 6, h: 2.6, c: 0x3f6d6a, tag: 'mid' },
  { x: 8, z: 14, w: 6, d: 2.6, h: 2.6, c: 0x8a4a26, tag: 'mid' },
  { x: 8, z: 16.6, w: 6, d: 2.6, h: 2.6, c: 0xb05a28, tag: 'mid' },
  { x: -24, z: 16, w: 6, d: 2.6, h: 2.6, c: 0x6e3f22, tag: 'mid' },
  // Low crates (vaultable cover, h 1.1).
  { x: -6, z: 12, w: 2.2, d: 2.2, h: 1.1, c: 0x5c5142, tag: 'crate' },
  { x: 0, z: -2, w: 2.2, d: 2.2, h: 1.1, c: 0x5c5142, tag: 'crate' },
  { x: 16, z: -2, w: 2.2, d: 2.2, h: 1.1, c: 0x5c5142, tag: 'crate' },
  { x: -18, z: -2, w: 2.2, d: 2.2, h: 1.1, c: 0x5c5142, tag: 'crate' },
  { x: 26, z: 6, w: 2.2, d: 2.2, h: 1.1, c: 0x5c5142, tag: 'crate' },
];

export const SITES = {
  A: { x: -26, z: -12, r: 5.5, label: 'SITE A — WAREHOUSE' },
  B: { x: 26, z: 12, r: 5.5, label: 'SITE B — CONTAINER STACK' },
};

export const SPAWNS = {
  us: [{ x: -28, z: 18 }, { x: -30, z: 20 }, { x: -26, z: 20 }],
  foe: [{ x: 28, z: -18 }, { x: 30, z: -20 }, { x: 26, z: -20 }],
};

// Waypoint graph: nodes on the lanes; bots walk node to node.
export const WAYPOINTS = [
  { x: -28, z: 18 }, { x: -20, z: 10 }, { x: -14, z: 2 }, { x: -10, z: -6 }, // west lane to A
  { x: -20, z: -12 }, { x: -26, z: -12 }, // into site A
  { x: -8, z: 12 }, { x: 0, z: 6 }, { x: 6, z: 0 }, { x: 12, z: -4 }, // mid lane
  { x: 18, z: 8 }, { x: 24, z: 12 }, { x: 26, z: 12 }, // mid to site B
  { x: -2, z: 18 }, { x: 10, z: 16 }, { x: 20, z: 14 }, // south lane
  { x: 28, z: -18 }, { x: 20, z: -12 }, { x: 14, z: -12 }, // foe spawn to mid
  { x: -4, z: -18 }, { x: -12, z: -16 }, // north lane to A
  { x: 16, z: 0 }, { x: 22, z: 6 }, // east lane to site B
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [1, 6], [6, 7], [7, 8], [8, 9],
  [9, 10], [10, 11], [11, 12], [6, 13], [13, 14], [14, 15], [16, 17], [17, 18],
  [18, 9], [3, 19], [19, 20], [20, 5], [8, 21], [21, 22], [22, 12],
];

export function buildWorld(scene) {
  const colliders = [];
  const group = new THREE.Group();
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.solid = true;
  group.add(ground);

  // Painted lane markings on the asphalt: two guide strips, no texture files.
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xd97b2f });
  for (const [x, z, w, d] of [[-20, 4, 0.3, 26], [14, 4, 0.3, 26], [0, -18, 26, 0.3]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.02, z);
    group.add(strip);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  for (const b of BOXES) {
    const mat = new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.85, metalness: 0.15 });
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.solid = true;
    group.add(mesh);
    const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x1a1d22 }));
    edge.scale.copy(mesh.scale);
    edge.position.copy(mesh.position);
    group.add(edge);
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h });
  }

  // Amber floodlight poles along mid lane.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xf2b544 });
  for (const [x, z] of [[-10, 4], [6, -4], [18, 10], [-20, -6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 8), poleMat);
    pole.position.set(x, 3, z);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), lampMat);
    lamp.position.set(x, 6.1, z);
    group.add(lamp);
    const light = new THREE.PointLight(0xf2b544, 18, 18, 1.8);
    light.position.set(x, 5.8, z);
    group.add(light);
  }

  // Site markers: flat glowing rings on the ground.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xd97b2f, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
  }

  // Dusk sky: big gradient dome via vertex-coloured sphere, plus fog.
  const skyGeo = new THREE.SphereGeometry(180, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1c2733) },
      mid: { value: new THREE.Color(0x8a4a26) },
      bot: { value: new THREE.Color(0x2a2118) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.1, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0x2a2118, 40, 130);

  scene.add(group);
  return { colliders, group };
}

// Circle-vs-AABB resolve: push the circle (x,z,r) out of every collider it overlaps.
export function collideCircle(colliders, x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
  }
  x = Math.max(-MAP.halfX + r, Math.min(MAP.halfX - r, x));
  z = Math.max(-MAP.halfZ + r, Math.min(MAP.halfZ - r, z));
  return { x, z };
}

// Line-of-sight on the 2D plane: true when no collider taller than eyeH blocks the segment.
export function hasLineOfSight(colliders, ax, az, bx, bz, eyeH = 1.5) {
  for (const c of colliders) {
    if (c.h < eyeH) continue;
    if (segmentHitsBox(ax, az, bx, bz, c)) return false;
  }
  return true;
}

function segmentHitsBox(ax, az, bx, bz, c) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - c.minX], [dx, c.maxX - ax], [-dz, az - c.minZ], [dz, c.maxZ - az]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// Dijkstra over the waypoint graph; returns an array of node indices.
export function findPath(fromIdx, toIdx) {
  const n = WAYPOINTS.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[fromIdx] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === toIdx) break;
    for (const [a, b] of EDGES) {
      const v = a === u ? b : b === u ? a : -1;
      if (v === -1 || done[v]) continue;
      const w = Math.hypot(WAYPOINTS[v].x - WAYPOINTS[u].x, WAYPOINTS[v].z - WAYPOINTS[u].z);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  const path = [];
  let cur = toIdx;
  while (cur !== -1) { path.unshift(cur); cur = prev[cur]; }
  return path.length > 1 ? path : [fromIdx, toIdx];
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  WAYPOINTS.forEach((w, i) => {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
