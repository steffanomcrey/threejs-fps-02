// main.js — bootstrap, fixed-step loop, shooting, the charge, round flow and
// the screenshot hooks. The sim runs at 60 Hz; rendering reads state only.
import * as THREE from 'three';
import { buildWorld, SITES, SPAWNS, hasLineOfSight } from './world.js';
import { Player } from './player.js';
import { Squad } from './bots.js';
import { WEAPONS, ORDER, FRAG_PRICE, FRAG_DAMAGE, FRAG_RADIUS, currentSpread, newLoadout, buyWeapon, buyFrag, Grenade } from './weapons.js';
import { newMatch, startBuy, startLive, endRound, nextRound, addFeed, PHASE, WIN_SCORE, ROUND_TIME } from './state.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | buy | end — screenshot hooks

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c2733);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0x8a7a66, 0x1a1d22, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xf2b544, 1.6);
sun.position.set(30, 40, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
scene.add(sun);

const { colliders, group: worldGroup } = buildWorld(scene);
const solidMeshes = [];
worldGroup.traverse((o) => { if (o.userData.solid) solidMeshes.push(o); });

const player = new Player(colliders);
const squad = new Squad(scene, colliders);
const match = newMatch();
const loadout = newLoadout();
const hud = new Hud();
const sounds = new SoundBank();
const keys = new Set();

// Viewmodel: a low-poly rifle parented to the camera.
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a26, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.7), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.5);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), wood);
  grip.position.set(0, -0.15, 0.12);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.03), dark);
  sight.position.set(0, 0.1, -0.2);
  gun.add(body, barrel, grip, sight);
  gun.position.set(0.28, -0.26, -0.5);
  camera.add(gun);
}
scene.add(camera);
const muzzleLight = new THREE.PointLight(0xffc266, 0, 9, 2);
muzzleLight.position.set(0.28, -0.2, -1);
camera.add(muzzleLight);

// Charge device mesh (hidden until planted).
const chargeMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.6 }));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  lamp.position.set(0, 0.2, 0);
  lamp.name = 'chargeLamp';
  chargeMesh.add(box, lamp);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

const raycaster = new THREE.Raycaster();
const tracers = [];
const grenades = [];
let firing = false;
let lastShotT = 0;
let heat = 0;
let reloadT = 0;
let plantT = 0;
let chargeFuse = 0;
let chargeBeepT = 0;
let hudT = 0;
let acc = 0;
let lastT = performance.now();
let shotFired = false;
let shotReady = false;

function now() { return performance.now() / 1000; }

function muzzleWorld() {
  const v = new THREE.Vector3(0.28, -0.2, -1.1);
  return camera.localToWorld(v);
}

function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, t: 0.09 });
}

function currentDef() { return WEAPONS[loadout.current]; }

function tryFire() {
  const def = currentDef();
  const ammo = loadout.ammo[loadout.current];
  if (reloadT > 0) return;
  if (now() - lastShotT < 60 / def.fireRate) return;
  if (ammo.mag <= 0) { sounds.dry(); lastShotT = now(); return; }
  lastShotT = now();
  ammo.mag -= 1;
  heat = Math.min(1, heat + (def.auto ? 0.12 : 0.2));
  // Recoil: pitch kick plus a small random yaw drift.
  player.pitch += def.recoil * (0.8 + Math.random() * 0.4);
  player.yaw += (Math.random() - 0.5) * def.recoil * 0.4;
  sounds.shot(loadout.current);
  muzzleLight.intensity = 14;
  setTimeout(() => { muzzleLight.intensity = 0; }, 50);
  gun.position.z = -0.44;
  setTimeout(() => { gun.position.z = -0.5; }, 60);

  const pellets = def.pellets || 1;
  const spread = currentSpread(def, player.moving, player.crouched, heat);
  let hitAny = false;
  for (let p = 0; p < pellets; p++) {
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2 * spread,
      (Math.random() - 0.5) * 2 * spread,
      -1,
    ).normalize().applyEuler(camera.rotation);
    raycaster.set(camera.position, dir);
    raycaster.far = def.range;
    const targets = [...squad.bots.filter((b) => b.alive).map((b) => b.mesh), ...solidMeshes];
    const hits = raycaster.intersectObjects(targets, true);
    const end = hits.length ? hits[0].point : camera.position.clone().addScaledVector(dir, def.range);
    spawnTracer(muzzleWorld(), end, def.tracer);
    if (!hits.length) continue;
    const hit = hits[0];
    let obj = hit.object;
    while (obj && !obj.userData.bot) obj = obj.parent;
    if (!obj) continue; // hit the world, not a bot
    const bot = obj.userData.bot;
    const isHead = hit.object.name === 'head';
    const dmg = Math.round(def.damage * (isHead ? def.headMult : 1));
    const killed = bot.damage(dmg);
    hitAny = true;
    hud.hitmarker(true);
    setTimeout(() => hud.hitmarker(false), 120);
    if (killed) {
      match.money += 300;
      match.kills.us += 1;
      addFeed(match, `<b>YOU</b> ▸ ${bot.name} ${isHead ? '— HEADSHOT' : ''} <b>+$300</b>`);
      sounds.kill();
    } else {
      sounds.hit();
    }
  }
  if (!hitAny) { /* missed: nothing */ }
}

function startReload() {
  const def = currentDef();
  const ammo = loadout.ammo[loadout.current];
  if (reloadT > 0 || ammo.mag === def.mag || ammo.reserve === 0) return;
  reloadT = def.reloadMs / 1000;
  sounds.reload();
}

function finishReload() {
  const def = currentDef();
  const ammo = loadout.ammo[loadout.current];
  const need = def.mag - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
}

function throwGrenade() {
  if (loadout.frags <= 0 || match.phase !== PHASE.LIVE) return;
  loadout.frags -= 1;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const g = new Grenade(camera.position.clone(), dir);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }));
  mesh.position.copy(g.pos);
  scene.add(mesh);
  grenades.push({ g, mesh });
  sounds.reload();
}

function explodeGrenade(entry) {
  scene.remove(entry.mesh);
  const p = entry.g.pos;
  sounds.boom();
  const flash = new THREE.PointLight(0xffa040, 40, 18, 1.8);
  flash.position.copy(p);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 200);
  const damageAt = (x, z) => {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > FRAG_RADIUS) return 0;
    return Math.round(FRAG_DAMAGE * (1 - d / (FRAG_RADIUS * 1.4)));
  };
  for (const b of squad.bots) {
    if (!b.alive) continue;
    const dmg = damageAt(b.x, b.z);
    if (dmg <= 0) continue;
    if (b.damage(dmg)) {
      match.money += 300;
      match.kills.us += 1;
      addFeed(match, `<b>YOU</b> ▸ ${b.name} — FRAG <b>+$300</b>`);
    }
  }
  const pd = damageAt(player.x, player.z);
  if (pd > 0 && player.alive) {
    player.damage(pd);
    hud.hurtFlash();
    sounds.hurt();
    if (!player.alive) addFeed(match, `<b>YOU</b> were caught by your own frag`);
  }
  const pd2 = Math.hypot(player.x - p.x, player.z - p.z);
  if (pd2 < 10 && hasLineOfSight(colliders, player.x, player.z, p.x, p.z)) hud.whiteFlash();
}

// Bot shots resolve here: hit chance falls with distance and target movement.
function onBotShot(bot, target, dist) {
  const from = new THREE.Vector3(bot.x, 1.35, bot.z);
  const to = target.kind === 'player'
    ? new THREE.Vector3(player.x, player.eye - 0.15, player.z)
    : new THREE.Vector3(target.ref.x, 1.2, target.ref.z);
  spawnTracer(from, to, 0xe0483e);
  const moving = target.kind === 'player' ? player.moving : true;
  let chance = 0.62 - dist * 0.012 - (moving ? 0.12 : 0) - (target.kind === 'player' && player.crouched ? 0.08 : 0);
  chance = Math.max(0.06, Math.min(0.75, chance));
  sounds.enemyShot(dist);
  if (Math.random() > chance) return;
  const dmg = 11 + Math.floor(Math.random() * 11);
  if (target.kind === 'player') {
    player.damage(dmg);
    hud.hurtFlash();
    sounds.hurt();
    if (!player.alive) addFeed(match, `<b>${bot.name}</b> ▸ YOU`);
  } else {
    const victim = target.ref;
    if (victim.damage(dmg)) {
      addFeed(match, `<b>${bot.name}</b> ▸ ${victim.name}`);
      if (victim.team === 'foe') match.kills.us += 1; else match.kills.foe += 1;
    }
  }
}

function onPlanted(bot, site) {
  const s = SITES[site];
  match.charge.state = 'planted';
  match.charge.site = site;
  match.charge.x = s.x;
  match.charge.z = s.z;
  chargeFuse = 35;
  match.phaseT = 35;
  chargeMesh.position.set(s.x, 0.35, s.z);
  chargeMesh.visible = true;
  addFeed(match, `<b>${bot.name}</b> planted the charge at SITE ${site}`);
  sounds.plant();
}

function onDefused(bot) {
  match.charge.state = 'idle';
  chargeMesh.visible = false;
  addFeed(match, `<b>${bot.name}</b> defused the charge`);
  endRound(match, 'us', `${bot.name} defused the charge`);
  onRoundEnd();
}

function checkRoundEnd() {
  if (match.phase !== PHASE.LIVE) return;
  const usAlive = squad.alive('us').length + (player.alive ? 1 : 0);
  const foeAlive = squad.alive('foe').length;
  if (foeAlive === 0) { endRound(match, 'us', 'Rustjackals eliminated'); onRoundEnd(); }
  else if (usAlive === 0) { endRound(match, 'foe', 'Dockhands eliminated'); onRoundEnd(); }
  else if (match.phaseT <= 0 && match.charge.state !== 'planted') { endRound(match, 'foe', 'Time expired — site held'); onRoundEnd(); }
  else if (match.charge.state === 'planted' && chargeFuse <= 0) {
    chargeMesh.visible = false;
    addFeed(match, `The charge detonated at SITE ${match.charge.site}`);
    sounds.boom();
    endRound(match, 'foe', 'Charge detonated');
    onRoundEnd();
  }
}

function onRoundEnd() {
  const won = match.roundWinner === 'us';
  sounds[won ? 'roundWin' : 'roundLose']();
  hud.showBanner(won ? 'win' : 'lose', won ? 'ROUND WON' : 'ROUND LOST', match.roundReason);
}

function startRound() {
  squad.resetRound();
  player.reset(SPAWNS.us[0].x, SPAWNS.us[0].z, Math.PI);
  camera.position.set(player.x, player.eye, player.z);
  camera.rotation.set(0, player.yaw, 0);
  chargeMesh.visible = false;
  hud.hideBanner();
  hud.hidePrompt();
  startBuy(match);
}

function beginMatch() {
  hud.hideMenu();
  sounds.ensure();
  startRound();
}

function endMatch() {
  const won = match.scoreUs >= WIN_SCORE;
  hud.showMenu(
    won ? 'TERMINAL SECURED' : 'TERMINAL LOST',
    won
      ? `Dockhands take Rustline Terminal ${match.scoreUs}–${match.scoreFoe}. The Rustjackals leave the yard to you.`
      : `The Rustjackals hold Rustline Terminal ${match.scoreFoe}–${match.scoreUs}. Run it back and take the yard.`,
    'Play again',
  );
  document.getElementById('play').onclick = () => location.reload();
}

// --- Input ---
document.getElementById('play').addEventListener('click', () => {
  if (match.phase === PHASE.MENU) beginMatch();
  else if (match.phase === PHASE.MATCH_END) location.reload();
  else { hud.hideMenu(); renderer.domElement.requestPointerLock(); }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && match.phase === PHASE.LIVE && !SHOT) {
    hud.showMenu('PAUSED', 'Pointer lock released. Click to jump back into the round.', 'Resume');
  }
});
renderer.domElement.addEventListener('click', () => {
  if (match.phase === PHASE.LIVE && !document.pointerLockElement && !SHOT) renderer.domElement.requestPointerLock();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch -= e.movementY * 0.0021;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && document.pointerLockElement === renderer.domElement) firing = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyB' && match.phase === PHASE.BUY) hud.setBuyOpen(!document.getElementById('buy').classList.contains('open'));
  if (e.code.startsWith('Digit')) {
    const idx = Number(e.code.slice(5)) - 1;
    const id = ORDER[idx];
    if (id && loadout.owned[id]) loadout.current = id;
  }
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
hud.onBuyWeapon = (id) => {
  const r = buyWeapon(loadout, match.money, id);
  if (r.ok) match.money = r.money;
};
hud.onBuyFrag = () => {
  const r = buyFrag(loadout, match.money);
  if (r.ok) match.money = r.money;
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Fixed-step simulation ---
function step(dt) {
  if (match.phase === PHASE.BUY) {
    match.phaseT -= dt;
    if (match.phaseT <= 0) { hud.setBuyOpen(false); startLive(match); }
  } else if (match.phase === PHASE.LIVE) {
    match.phaseT -= dt;
    if (match.charge.state === 'planted') {
      chargeFuse -= dt;
      chargeBeepT -= dt;
      if (chargeBeepT <= 0) { sounds.beep(); chargeBeepT = 1; }
      const lamp = chargeMesh.getObjectByName('chargeLamp');
      if (lamp) lamp.material.color.setHex(Math.floor(now() * 2) % 2 ? 0xff3020 : 0x551008);
    }
    // Player plant / defuse channel on E.
    const nearSite = (site) => Math.hypot(player.x - SITES[site].x, player.z - SITES[site].z) < SITES[site].r;
    if (player.alive && keys.has('KeyE')) {
      if (match.charge.state === 'idle' && (nearSite('A') || nearSite('B'))) {
        const site = nearSite('A') ? 'A' : 'B';
        plantT += dt;
        hud.showPrompt(`PLANTING CHARGE AT SITE ${site}… <b>${Math.ceil(3 - plantT)}s</b>`);
        if (plantT >= 3) {
          plantT = 0;
          hud.hidePrompt();
          onPlanted({ name: 'YOU' }, site);
        }
      } else if (match.charge.state === 'planted' && Math.hypot(player.x - match.charge.x, player.z - match.charge.z) < 2.5) {
        plantT += dt;
        hud.showPrompt(`DEFUSING… <b>${Math.ceil(3.5 - plantT)}s</b>`);
        if (plantT >= 3.5) {
          plantT = 0;
          hud.hidePrompt();
          match.charge.state = 'idle';
          chargeMesh.visible = false;
          addFeed(match, `<b>YOU</b> defused the charge`);
          endRound(match, 'us', 'You defused the charge');
          onRoundEnd();
        }
      } else plantT = 0;
    } else {
      plantT = 0;
      if (match.phase === PHASE.LIVE && player.alive) {
        if (match.charge.state === 'idle' && (nearSite('A') || nearSite('B'))) hud.showPrompt('Hold <b>E</b> to plant the charge');
        else if (match.charge.state === 'planted' && Math.hypot(player.x - match.charge.x, player.z - match.charge.z) < 2.5) hud.showPrompt('Hold <b>E</b> to defuse');
        else hud.hidePrompt();
      }
    }

    player.step(dt, keys);
    squad.step(dt, { player, bots: squad.bots, match, onBotShot, onPlanted, onDefused });
    if (firing) tryFire();
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) finishReload(); }
    heat = Math.max(0, heat - dt * 0.9);
    // Recoil recovery: pitch eases back toward the aim point.
    player.pitch *= Math.exp(-dt * 2.2);
    for (let i = grenades.length - 1; i >= 0; i--) {
      const entry = grenades[i];
      if (entry.g.step(dt)) { explodeGrenade(entry); grenades.splice(i, 1); }
      else entry.mesh.position.copy(entry.g.pos);
    }
    checkRoundEnd();
  } else if (match.phase === PHASE.ROUND_END) {
    match.phaseT -= dt;
    if (match.phaseT <= 0) { hud.hideBanner(); nextRound(match); if (match.phase === PHASE.MATCH_END) endMatch(); else startRound(); }
  }

  // Camera follows the player every step.
  camera.position.set(player.x, player.eye, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

// --- Screenshot hooks: deterministic staged scenes, no pointer lock ---
function applyShot() {
  if (SHOT === 'start') { shotReady = true; return; }
  beginMatch();
  if (SHOT === 'buy') {
    hud.setBuyOpen(true);
    player.yaw = Math.PI * 0.75;
    setTimeout(() => { shotReady = true; }, 400);
    return;
  }
  if (SHOT === 'play') {
    // Jump straight into the live round with enemies in view down the south lane.
    match.phase = PHASE.LIVE;
    match.phaseT = ROUND_TIME;
    player.x = 0; player.z = 18; player.yaw = -0.2; player.pitch = 0;
    const foe = squad.bots.find((b) => b.team === 'foe');
    foe.x = 2; foe.z = 8; foe.mesh.position.set(2, 0, 8);
    const foe2 = squad.bots.find((b) => b.team === 'foe' && b !== foe);
    foe2.x = -4; foe2.z = 6; foe2.mesh.position.set(-4, 0, 6);
    loadout.current = 'longbow';
    loadout.owned.longbow = true;
    loadout.ammo.longbow = { mag: 25, reserve: 75 };
    setTimeout(() => { tryFire(); shotFired = true; setTimeout(() => { shotReady = true; }, 150); }, 500);
    return;
  }
  if (SHOT === 'end') {
    match.scoreUs = 5; match.scoreFoe = 3;
    match.phase = PHASE.MATCH_END;
    endMatch();
    shotReady = true;
    return;
  }
  shotReady = true;
}

function frame(t) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, t - lastT);
  lastT = t;
  acc += dtMs / 1000;
  let n = 0;
  while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n += 1; }
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t -= dtMs / 1000;
    if (tracers[i].t <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  hudT -= dtMs / 1000;
  if (hudT <= 0) { hud.refresh(match, player, loadout, squad); hudT = 0.15; }
  renderer.render(scene, camera);
  if (SHOT && shotReady && !window.__shotReady) window.__shotReady = true;
}

applyShot();
requestAnimationFrame(frame);
window.__game = { match, player, squad, loadout, get phase() { return match.phase; } };
