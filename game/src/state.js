// state.js — one object owns the match: phase machine, rounds, economy, the
// charge, and the feed. Rendering and input never write here directly.
export const PHASE = { MENU: 'menu', BUY: 'buy', LIVE: 'live', ROUND_END: 'round_end', MATCH_END: 'match_end' };
export const WIN_SCORE = 5;
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const ROUND_END_TIME = 4;

export function newMatch() {
  return {
    phase: PHASE.MENU,
    phaseT: 0,
    round: 1,
    scoreUs: 0,
    scoreFoe: 0,
    money: 800,
    roundWinner: null,
    roundReason: '',
    charge: { state: 'idle', site: null, plantT: 0, x: 0, z: 0 },
    feed: [],
    kills: { us: 0, foe: 0 },
  };
}

export function startBuy(match) {
  match.phase = PHASE.BUY;
  match.phaseT = BUY_TIME;
  match.charge = { state: 'idle', site: null, plantT: 0, x: 0, z: 0 };
}

export function startLive(match) {
  match.phase = PHASE.LIVE;
  match.phaseT = ROUND_TIME;
}

export function endRound(match, winner, reason) {
  match.phase = PHASE.ROUND_END;
  match.phaseT = ROUND_END_TIME;
  match.roundWinner = winner;
  match.roundReason = reason;
  if (winner === 'us') {
    match.scoreUs += 1;
    match.money += 3250;
  } else if (winner === 'foe') {
    match.scoreFoe += 1;
    match.money += 1900;
  } else {
    match.money += 1400;
  }
}

export function nextRound(match) {
  match.round += 1;
  if (match.scoreUs >= WIN_SCORE || match.scoreFoe >= WIN_SCORE) {
    match.phase = PHASE.MATCH_END;
    match.phaseT = 0;
  } else {
    startBuy(match);
  }
}

export function addFeed(match, text) {
  match.feed.unshift(text);
  if (match.feed.length > 5) match.feed.pop();
}

export function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
