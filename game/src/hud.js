// hud.js — every DOM write goes through here, so the sim never touches the
// page directly. Elements are looked up once at construction.
import { WEAPONS, ORDER, FRAG_PRICE } from './weapons.js';
import { fmtTime, PHASE } from './state.js';

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      healthNum: $('health-num'), healthFill: $('health-fill'), money: $('money'),
      armor: $('armor-line'), weaponName: $('weapon-name'), ammoMag: $('ammo-mag'),
      ammoReserve: $('ammo-reserve'), ammo: $('ammo'), grenades: $('grenades'),
      timer: $('timer'), roundLabel: $('round-label'), scoreUs: $('score-us'),
      scoreFoe: $('score-foe'), teamUs: $('team-us'), teamFoe: $('team-foe'),
      objective: $('objective'), banner: $('banner'), bannerTitle: $('banner-title'),
      bannerSub: $('banner-sub'), feed: $('feed'), prompt: $('prompt'),
      buy: $('buy'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'),
      overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
      vignette: $('vignette'), flash: $('flash'), hitmarker: $('hitmarker'),
    };
    this._buildBuyGrid();
  }
  _buildBuyGrid() {
    this.el.buyGrid.innerHTML = '';
    for (const id of ORDER) {
      const def = WEAPONS[id];
      const div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.id = id;
      div.innerHTML = `<div><div class="nm">${def.name}</div><div class="ds">DMG ${def.damage} · ${def.mag} rnd mag · ${def.auto ? 'AUTO' : 'SEMI'}</div></div><div class="pr">$${def.price}</div>`;
      div.addEventListener('click', () => this.onBuyWeapon && this.onBuyWeapon(id));
      this.el.buyGrid.appendChild(div);
    }
    const frag = document.createElement('div');
    frag.className = 'buy-item';
    frag.dataset.id = 'frag';
    frag.innerHTML = `<div><div class="nm">FRAG GRENADE</div><div class="ds">Thrown with G · radius blast, max 2</div></div><div class="pr">$${FRAG_PRICE}</div>`;
    frag.addEventListener('click', () => this.onBuyFrag && this.onBuyFrag());
    this.el.buyGrid.appendChild(frag);
  }
  refresh(match, player, loadout, squad) {
    const def = WEAPONS[loadout.current];
    const ammo = loadout.ammo[loadout.current];
    this.el.healthNum.textContent = Math.ceil(player.hp);
    this.el.healthFill.style.width = `${Math.max(0, player.hp)}%`;
    this.el.healthFill.classList.toggle('low', player.hp <= 30);
    this.el.money.textContent = `$${match.money}`;
    this.el.armor.textContent = `KEVLAR ${Math.round(player.armor)}`;
    this.el.weaponName.textContent = def.name;
    this.el.ammoMag.textContent = ammo.mag;
    this.el.ammoReserve.textContent = `/ ${ammo.reserve}`;
    this.el.ammo.classList.toggle('empty', ammo.mag === 0);
    this.el.grenades.textContent = `FRAG × ${loadout.frags}   [G]`;
    this.el.timer.textContent = fmtTime(match.phaseT);
    this.el.timer.classList.toggle('low', match.phase === 'live' && match.phaseT <= 10);
    this.el.roundLabel.textContent = `ROUND ${match.round}`;
    this.el.scoreUs.textContent = match.scoreUs;
    this.el.scoreFoe.textContent = match.scoreFoe;
    this.el.teamUs.innerHTML = squad.alive('us').map(() => '<span class="pip"></span>').join('') +
      squad.bots.filter((b) => b.team === 'us' && !b.alive).map(() => '<span class="pip dead"></span>').join('') +
      (player.alive ? '<span class="pip"></span>' : '<span class="pip dead"></span>');
    this.el.teamFoe.innerHTML = squad.alive('foe').map(() => '<span class="pip foe"></span>').join('') +
      squad.bots.filter((b) => b.team === 'foe' && !b.alive).map(() => '<span class="pip foe dead"></span>').join('');
    this.el.feed.innerHTML = match.feed.map((f) => `<div>${f}</div>`).join('');
    const site = match.charge.site ? `SITE ${match.charge.site}` : 'SITE A OR SITE B';
    this.el.objective.textContent = match.charge.state === 'planted'
      ? `CHARGE PLANTED AT ${site} — DEFUSE IT OR LOSE THE ROUND`
      : match.charge.state === 'planting'
        ? `THE CHARGE IS BEING PLANTED AT ${site}`
        : `PLANT THE CHARGE AT ${site} — OR ELIMINATE THE RUSTJACKALS`;
    this.el.buyMoney.textContent = `$${match.money}`;
    this.el.buyTimer.textContent = match.phase === PHASE.BUY ? `— ${fmtTime(match.phaseT)}` : '';
    for (const item of this.el.buyGrid.children) {
      const id = item.dataset.id;
      if (id === 'frag') {
        item.classList.toggle('cant', match.money < FRAG_PRICE || loadout.frags >= 2);
      } else {
        item.classList.toggle('owned', !!loadout.owned[id]);
        item.classList.toggle('cant', !loadout.owned[id] && match.money < WEAPONS[id].price);
      }
    }
  }
  setBuyOpen(open) { this.el.buy.classList.toggle('open', open); }
  showBanner(kind, title, sub) {
    this.el.banner.style.display = 'block';
    this.el.banner.className = kind;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
  }
  hideBanner() { this.el.banner.style.display = 'none'; }
  showPrompt(html) { this.el.prompt.innerHTML = html; this.el.prompt.style.display = 'block'; }
  hidePrompt() { this.el.prompt.style.display = 'none'; }
  hitmarker(on) { this.el.hitmarker.classList.toggle('on', on); }
  hurtFlash() {
    this.el.vignette.style.opacity = '1';
    setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 160);
  }
  whiteFlash() {
    this.el.flash.style.opacity = '0.85';
    setTimeout(() => { this.el.flash.style.opacity = '0'; }, 220);
  }
  showMenu(title, copy, button) {
    this.el.overlay.hidden = false;
    this.el.overlayTitle.textContent = title;
    this.el.overlayCopy.textContent = copy;
    document.getElementById('play').textContent = button;
  }
  hideMenu() { this.el.overlay.hidden = true; }
}
