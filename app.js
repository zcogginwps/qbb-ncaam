/* Quad Box Buddy - NCAAM — college basketball scoreboard that tells you what to watch.
 * Data comes straight from ESPN's public scoreboard feed (no key needed).
 *
 * Sibling app to the football QBB. Two things are deliberately different:
 *  - basketball is date-based, not week-based, so the week dropdown is a date picker;
 *  - every threshold here was calibrated on 3,226 completed D1 games from January-March
 *    2026 (conference play, so the sample is not November buy-game biased). The football
 *    numbers were NOT ported - see the thresholds block below for the measured fire rates.
 */

const ESPN_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=400';
// groups=50 is all of Division I men's. Unlike football there is only one feed to read:
// every D1 game appears here exactly once, so there is nothing to merge.
const D1_GROUP = 50;

// Date selection. null means "whatever ESPN says today is". Mirrored into the URL
// (?date=20261101) so a particular day can be linked to; a plain link opens today.
let selectedDate = dateFromUrl();
let currentDate = null; // YYYYMMDD ESPN actually served, from the first fetch
let calendar = [];      // YYYYMMDD strings ESPN has games for

function dateFromUrl() {
  const d = new URLSearchParams(location.search).get('date');
  return d && /^\d{8}$/.test(d) ? d : null;
}

function scoreboardUrl() {
  return `${ESPN_BASE}&groups=${D1_GROUP}${selectedDate ? `&dates=${selectedDate}` : ''}`;
}

// ESPN conference ids -> filter keys. These are the BASKETBALL ids and they do not match
// football's: 8 is the Big 12 here but was the SEC there, and the ACC is 2 here and 1 there.
// Verified against the D1 standings tree (31 conferences, 365 teams) on 2026-10-29.
// Every other D1 conference rolls up into "mid", so no D1 game is ever unfilterable.
const CONF_KEYS = { '23': 'sec', '7': 'b1g', '8': 'b12', '2': 'acc', '4': 'be' };
const MAJOR_KEYS = ['sec', 'b1g', 'b12', 'acc', 'be'];
const confKeyFor = confId => CONF_KEYS[String(confId)] || 'mid';
// 'fav' and 'top25' are not conference keys: they match starred games and games with a
// ranked team (in the selected poll) respectively. Chips are OR'd together.
const ALL_FILTERS = ['fav', 'top25', ...MAJOR_KEYS, 'mid'];
const DEFAULT_FILTERS = ['fav', 'top25', ...MAJOR_KEYS]; // majors + ranked (+ starred) until the user opts in

/* ---------- thresholds ----------
 * Every number below is annotated with how often it actually fired on the calibration
 * sample. Zane's target from the football app is roughly 1 game in 10 to 1 in 20: more
 * often than that and a colour becomes wallpaper, rarer and it never shows up.
 *
 * Basketball notes that drove these:
 *  - median final margin is 9 and the median line is only 5.5 (football's was 15-25), so
 *    football's "7+ favourite" bar would have excluded over half the slate. 
 *  - margin late in the second half is remarkably stable: ~21% of games are within 3 at
 *    the 2:00 mark and ~21% are still within 3 at 5:00. Tightening the CLOCK barely
 *    changes the rate; only the MARGIN does. That is why Close Game keys on one
 *    possession rather than on a shorter window.
 */
const ONE_POSS = 3;              // a one-possession game
const TIER_SIZE = ONE_POSS;      // possessions; used for the card label and the comeback stall test

/* Ordering the live board.
 *
 * Football sorted by margin tier. Basketball is a game of runs, so that churned constantly
 * AND got the order wrong: a 3-point game early outranked a 5-point game late. What a
 * margin means depends entirely on when it happens.
 *
 * So a game is judged on how big the deficit is against how big a deficit is still WITHIN
 * REACH at this moment. Reach is a curve, not a constant:
 *   - early, before many points are on the board, close has to mean closer  (total / 7)
 *   - through the middle of the game anything under ~10 is in reach whatever the clock
 *   - at the end the clock takes over: ~1.5 points per minute left, plus a possession
 * Then A = margin / reach, and the bands are even cuts on A: within reach, twice that, and
 * beyond. Measured on 499 real game timelines polled every 15s.
 *
 * Band 1 deliberately holds about two thirds of the board. Most basketball games genuinely
 * ARE close; the band still sheds the ones that are not, and inside it the sort by time
 * left does the real work - a game can only still be in band 1 late if reach has tapered,
 * which means it is genuinely tight.
 */
const REACH_CAP = 10;            // a deficit under this is in reach for most of the game
const REACH_FLOOR = 6;           // ...but never judge by fewer points than this
const REACH_PER_MIN = 1.5;       // endgame: points per minute still on the clock
const REACH_BASE = 2.5;          // ...plus a possession
const REACH_DIV = 7;             // early: reach grows with the points already scored
const BAND_CUTS = [1.0, 2.0, 3.2];
// A band only changes once the game clears the line by this much, so a single basket
// either side of a boundary cannot make a card jump back and forth. Proportional rather
// than a fixed amount, because A is itself a ratio. Takes the share of polls that move a
// card from 6.9% to 4.4% (football-style margin tiers churned on 22.6%).
const BAND_SLACK = 0.10;

const UPSET_MIN_SPREAD = 6;      // favourite must be laying MORE than this (6.5+)
const UPSET_ALERT_SECONDS = 600; // ...and be trailing with under 10:00 left -> 9.3% of games
const UPSET_WATCH_AFTER = 2100;  // the quieter watch starts after the first 5:00 of the game

// Measured in REAL time, not game time: a basketball game takes ~122 real minutes for 40
// of play, and the last 2:00 of game clock is 10.5% of the broadcast. At within 3 / under
// 2:00 this lit up only 2.5% of the live board at any instant - one flashing card on a
// 20-game night, which is too thin to be doing any work.
const CLOSE_MAX_DIFF = 5;        // within 5...
const CLOSE_SECONDS_LEFT = 180;  // ...under 3:00 to go -> 4.5% of the board, ~2 cards in 40

const GOOD_GAME_DIFF = 6;        // two possessions, both teams ranked, second half

const COMEBACK_CUT = 15;         // a lead has shrunk by 15+...
const COMEBACK_MAX_DIFF = 5;     // ...and the game is now within 5 -> 15.3% of games

const BLOWOUT_MAX_SPREAD = 4;    // the line said toss-up (4 or less)...
const BLOWOUT_MIN_LEAD = 20;     // ...but someone is up 20 -> 9.3% of games

// Final-game tints.
const UPSET_WIN_MIN_SPREAD = UPSET_MIN_SPREAD; // dog of >6 won -> 8.6% (1 in 12)
const CLOSE_CALL_MIN_SPREAD = 8;               // fav of 8+ ...
const CLOSE_CALL_MAX_DIFF = 5;                 // ...survived by <=5 -> 5.1% (1 in 20)
const BLOWOUT_WIN_MIN_DIFF = 22;               // actually lopsided...
const BLOWOUT_WIN_MARGIN = 18;                 // ...AND 18+ clear of the line -> 5.7% (1 in 18)
// Both halves of the blowout rule are required. Football learned this the hard way: a
// 21-point underdog winning by 1 "beat the number by 22" and got called a blowout.
const COMEBACK_WIN_DEFICIT = 14;  // winner overcame a tracked deficit of 14+ ...
const COMEBACK_WIN_HALF = 8;      // ...or trailed by 8+ at the half -> together 6.7% (1 in 15)
// The halftime arm matters more than it looks. Basketball linescores have only two entries,
// so a game this app did not watch live has no in-half lead history to read: the tracked
// deficit alone would catch just 16% of real comebacks on a cold load. The halftime test
// needs nothing but the box score and catches 5.0% of finals on its own.

const HALF_SECONDS = 1200;       // 20-minute halves
const NEW_GAME_CLOCK = 1080;     // first 2:00 of the 1st half sits at the bottom as "new game"
const RUN_MIN = 6;               // show the run line at 6 unanswered points
const REORDER_MS = 1500;         // how slowly cards slide when the order changes
const FLASH_MS = 2000;           // one pulse for every alert colour (keep in sync with style.css)
// Every flashing card follows one heartbeat on <body> rather than its own CSS animation, so
// reordering a card in the DOM cannot leave it out of phase with the rest.
(function heartbeat() {
  requestAnimationFrame(heartbeat);
  document.body.classList.toggle('pulse', Math.floor(Date.now() / (FLASH_MS / 2)) % 2 === 1);
})();

const LIVE_POLL_MS = 15000;
const IDLE_POLL_MS = 60000;

const DEMO = new URLSearchParams(location.search).has('demo');
// ?demo=shuffle also nudges scores every few seconds so the reorder slide can be watched.
const DEMO_SHUFFLE = new URLSearchParams(location.search).get('demo') === 'shuffle';

// Bumped on every deploy (see scripts/bump.sh). GitHub Pages and iOS home-screen apps
// cache aggressively, so each poll also checks version.json and reloads when it changes.
const APP_VERSION = '1';
const VERSION_URL = 'version.json';

// ---------- persistence ----------
// GitHub Pages serves both QBB apps from the SAME origin (zcogginwps.github.io), so
// localStorage is shared with the football app. Every key here is prefixed qbbm_ to keep
// the two apps from reading each other's state.
const K = k => `qbbm_${k}`;
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(K(key)); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(K(key), JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

// The scoreboard feed drops the odds the moment a game tips, but ESPN's per-game odds
// endpoint keeps them through the final. Remember every line we see, keyed by game id, and
// backfill missing ones so someone opening the app mid-game still gets the spread.
const spreadCache = store.get('spreads', {});
const ODDS_URL = id =>
  `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${id}/competitions/${id}/odds`;
const ODDS_RETRY_MS = 10 * 60 * 1000;
const oddsAttempts = new Map(); // game id -> timestamp of last backfill attempt
// Storage key is versioned so changing the chips resets everyone to the defaults.
const FILTER_KEY = 'filters_v1';
let filters = new Set(store.get(FILTER_KEY, DEFAULT_FILTERS).filter(k => ALL_FILTERS.includes(k)));
if (filters.size === 0) filters = new Set(DEFAULT_FILTERS);

// Rankings. Basketball has only two: AP and the Coaches poll. There is no CFP-style
// committee ranking, and NET / KenPom / Torvik are not in this feed at all.
const RANKINGS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings';
const POLL_IDS = { '1': 'AP Top 25', '2': 'Coaches Poll' };
const POLL_SHORT = { '1': 'AP', '2': 'Coaches' };
const RANKINGS_TTL_MS = 30 * 60 * 1000;
let rankings = store.get('rankings', { at: 0, polls: {} }); // polls: id -> { name, ranks: { teamId: rank } }
let selectedPoll = store.get('poll', '1');

async function loadRankings(force) {
  if (!force && Date.now() - rankings.at < RANKINGS_TTL_MS && Object.keys(rankings.polls).length) return;
  try {
    const res = await fetch(RANKINGS_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const polls = {};
    for (const r of data.rankings || []) {
      if (!POLL_IDS[String(r.id)]) continue;
      const ranks = {};
      for (const x of r.ranks || []) if (x.team && x.current) ranks[String(x.team.id)] = x.current;
      if (Object.keys(ranks).length) polls[String(r.id)] = { name: POLL_IDS[String(r.id)], ranks };
    }
    if (Object.keys(polls).length) {
      rankings = { at: Date.now(), polls };
      store.set('rankings', rankings);
    }
  } catch { /* keep whatever we had; cards fall back to ESPN's curated rank */ }
  if (!rankings.polls[selectedPoll]) rankings.at = 0; // retry sooner, but never override the choice
  renderPollSelect();
  renderGames(games);
}

// Rank in the selected poll; ESPN's curated rank when the poll data has not loaded.
function pollRankOf(t) {
  const poll = rankings.polls[selectedPoll] || rankings.polls['1'];
  if (!poll) return t.curated;
  return poll.ranks[t.id] || null;
}
// What goes in the little slot left of the team name. During the NCAA tournament ESPN
// reuses curatedRank to carry the SEED, not a poll position, so it is labelled differently.
function rankInfo(t, g) {
  if (g && g.round && t.curated) return { rank: t.curated, seed: true };
  const r = pollRankOf(t);
  return r ? { rank: r, seed: false } : null;
}
function rankOf(t, g) { const r = rankInfo(t, g); return r ? r.rank : null; }
function isRankedGame(g) { return !!(pollRankOf(g.home) || pollRankOf(g.away)); }

// The poll menu pops up when the Top 25 chip is held (or right-clicked).
function renderPollSelect() {
  const menu = byId('poll-menu');
  const ids = Object.keys(POLL_IDS).filter(id => rankings.polls[id]);
  const items = ids.length ? ids : ['1'];
  const item = id => `<button role="menuitemradio" aria-checked="${id === selectedPoll}" data-poll="${id}">
      <span>${esc((rankings.polls[id] || { name: POLL_IDS[id] }).name)}</span>
      <span class="check">${id === selectedPoll ? '✓' : ''}</span>
    </button>`;
  menu.innerHTML = `<div class="title">Rankings <small>voted polls</small></div>${items.map(item).join('')}`;
  byId('poll-hint').textContent = `Hold Top 25 to pick the poll · ${POLL_SHORT[selectedPoll] || 'AP'}`;
}

function openPollMenu() {
  const menu = byId('poll-menu');
  const chip = byId('chip-top25');
  const top = document.querySelector('.top').getBoundingClientRect();
  const r = chip.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = `${r.bottom - top.top + 6}px`;
  menu.style.left = `${Math.max(0, r.left - top.left)}px`;
  const overflow = menu.getBoundingClientRect().right - (top.right - 4);
  if (overflow > 0) menu.style.left = `${Math.max(0, r.left - top.left - overflow)}px`;
}
function closePollMenu() { byId('poll-menu').hidden = true; }

// Biggest lead seen in each game, for the comeback watch. Seeded from the per-half line
// scores (so someone opening the app mid-game gets something) and then updated from every
// live score we observe. Persisted so an auto-reload does not forget it.
const peakLeads = store.get('peaks', {}); // game id -> { teamId, lead, at }
function notePeak(g, teamId, lead) {
  const cur = peakLeads[g.id];
  if (!cur || lead > cur.lead) peakLeads[g.id] = { teamId, lead, at: Date.now() };
}
function trackPeakLead(g, homeLines, awayLines) {
  if (g.state === 'pre') return;
  let h = 0, a = 0;
  const n = Math.min(homeLines.length, awayLines.length);
  for (let i = 0; i < n; i++) {
    h += homeLines[i]; a += awayLines[i];
    if (h !== a) notePeak(g, h > a ? g.home.id : g.away.id, Math.abs(h - a));
  }
  if (g.home.score !== g.away.score) {
    notePeak(g, g.home.score > g.away.score ? g.home.id : g.away.id, diff(g));
  }
  if (!peakLeads[g.id]) peakLeads[g.id] = { teamId: null, lead: 0, at: Date.now() };
}

// Unanswered points — basketball's answer to football's down & distance. ESPN sends no
// `situation` for basketball at all, so this is computed from the scores we poll: points
// one team has scored since the last time the other one did. Because we only look every
// 15s, a run where both teams scored inside one poll is not counted - so this UNDER-reports
// runs rather than inventing them.
const runs = store.get('runs', {}); // game id -> { teamId, points, hs, as, at }
function trackRun(g) {
  if (g.state !== 'in') { delete runs[g.id]; return null; }
  const prev = runs[g.id];
  const base = { teamId: null, points: 0, hs: g.home.score, as: g.away.score, at: Date.now() };
  if (!prev) { runs[g.id] = base; return null; }
  const dh = g.home.score - prev.hs, da = g.away.score - prev.as;
  if (dh < 0 || da < 0) { runs[g.id] = base; return null; } // ESPN corrected a score: start over
  const st = { ...prev, hs: g.home.score, as: g.away.score, at: Date.now() };
  if (dh > 0 && da > 0) { st.teamId = null; st.points = 0; }  // traded baskets: no run
  else if (dh > 0 || da > 0) {
    const id = dh > 0 ? g.home.id : g.away.id;
    const pts = dh > 0 ? dh : da;
    if (st.teamId === id) st.points += pts; else { st.teamId = id; st.points = pts; }
  }
  runs[g.id] = st;
  if (st.points < RUN_MIN || !st.teamId) return null;
  const team = st.teamId === g.home.id ? g.home : g.away;
  return { points: st.points, abbr: team.abbr };
}

function pruneState() {
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
  for (const bag of [peakLeads, comebackState, runs]) {
    for (const id of Object.keys(bag)) if ((bag[id].at || 0) < cutoff) delete bag[id];
  }
  const live = new Set(games.map(g => g.id));
  for (const id of bandState.keys()) if (!live.has(id)) bandState.delete(id);
}

// Favorites come from two places: games starred directly (by ESPN game id) and favorite
// teams (every game they play is starred automatically). Un-starring a game that is only a
// favorite through its team goes into an exclusion list, so the team stays favorited but
// that one game does not.
const favorites = new Set(store.get('favs', []));
const excludedGames = new Set(store.get('fav_excluded', []));
let favTeams = store.get('fav_teams', []); // [{id, name, full, abbr, logo, conf, cat}]
const favTeamIds = () => new Set(favTeams.map(t => t.id));

function isTeamFavorite(g) {
  const ids = favTeamIds();
  return ids.has(g.home.id) || ids.has(g.away.id);
}
function isFavoriteGame(g) {
  return !excludedGames.has(g.id) && (favorites.has(g.id) || isTeamFavorite(g));
}
function toggleFavorite(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  if (isFavoriteGame(g)) {
    favorites.delete(id);
    if (isTeamFavorite(g)) excludedGames.add(id);
  } else {
    excludedGames.delete(id);
    if (!isTeamFavorite(g)) favorites.add(id);
  }
  store.set('favs', [...favorites]);
  store.set('fav_excluded', [...excludedGames]);
  renderGames(games);
}
function saveFavTeams() {
  store.set('fav_teams', favTeams);
  els.favTeamsBtn.classList.toggle('has-teams', favTeams.length > 0);
  renderGames(games);
}

// ---------- parsing ----------
function parseTeam(c) {
  const t = c.team;
  const rank = c.curatedRank && c.curatedRank.current;
  const rec = (c.records || []).find(r => r.type === 'total') || (c.records || [])[0];
  return {
    id: t.id,
    abbr: t.abbreviation,
    name: t.shortDisplayName || t.name,
    full: t.displayName,
    logo: t.logo,
    curated: rank && rank <= 25 ? rank : null, // poll rank pregame, SEED during the tournament
    record: rec ? rec.summary : '',
    score: Number(c.score) || 0,
    confId: t.conferenceId,
    lines: (c.linescores || []).map(l => Number(l.value) || 0), // points per half
  };
}

// Shared by the scoreboard's inline odds and the per-game odds endpoint (same shape).
function spreadFromOdds(o, home, away) {
  if (!o || typeof o.spread !== 'number') return null;
  let favId;
  if (o.homeTeamOdds && o.homeTeamOdds.favorite) favId = home.id;
  else if (o.awayTeamOdds && o.awayTeamOdds.favorite) favId = away.id;
  else favId = o.spread < 0 ? home.id : away.id; // spread is home-relative
  const points = Math.abs(o.spread);
  if (points === 0) return { favId: null, points: 0, details: 'PK' };
  return { favId, points, details: o.details || '' };
}

function parseBroadcast(comp) {
  if (comp.broadcast) return comp.broadcast;
  const names = (comp.broadcasts || []).flatMap(b => b.names || []);
  if (names.length) return names.join('/');
  const geo = (comp.geoBroadcasts || []).find(g => g.media && g.media.shortName);
  return geo ? geo.media.shortName : '';
}

// Tournament games carry a note like "NCAA Men's Basketball Championship - East Region -
// 1st Round". Keep the part that identifies the round, and use it as the signal that
// curatedRank is a seed rather than a poll position.
function parseRound(comp) {
  const headline = ((comp.notes || [])[0] || {}).headline || '';
  if (!/championship|tournament|\bNIT\b/i.test(headline)) return '';
  const parts = headline.split(' - ').map(s => s.trim()).filter(Boolean);
  return (parts.length > 1 ? parts.slice(1).join(' · ') : headline).replace(/ Region/g, '');
}

function parseEvent(ev) {
  const comp = ev.competitions[0];
  const homeC = comp.competitors.find(c => c.homeAway === 'home');
  const awayC = comp.competitors.find(c => c.homeAway === 'away');
  if (!homeC || !awayC) return null;
  const home = parseTeam(homeC);
  const away = parseTeam(awayC);

  let spread = spreadFromOdds((comp.odds || [])[0], home, away);
  if (spread) spreadCache[ev.id] = spread;
  else spread = spreadCache[ev.id] || null;

  const st = ev.status;
  const g = {
    id: ev.id,
    date: new Date(ev.date),
    state: st.type.state,           // pre | in | post
    statusName: st.type.name,       // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_HALFTIME, ...
    statusDetail: st.type.shortDetail || st.type.detail || '',
    period: st.period || 0,
    clock: Number(st.clock) || 0,
    displayClock: st.displayClock || '',
    home, away, spread,
    tv: parseBroadcast(comp),
    round: parseRound(comp),
    confKeys: new Set([confKeyFor(home.confId), confKeyFor(away.confId)]),
  };
  trackPeakLead(g, home.lines, away.lines);
  g.run = trackRun(g);
  return g;
}

// ---------- game math ----------
function isLive(g) { return g.state === 'in'; }

// ESPN's exact halftime status name for basketball was not verifiable before the season
// started, so this checks the status name, the human-readable detail, and the one state
// that can only mean halftime (end of the 1st half with the clock at zero).
function isHalftime(g) {
  if (g.state !== 'in') return false;
  return /HALFTIME/.test(g.statusName) || /half/i.test(g.statusDetail)
    || (g.period === 1 && g.clock === 0);
}
function isEndOfPeriod(g) { return g.state === 'in' && /END_PERIOD/.test(g.statusName); }

function secondsLeft(g) {
  if (g.state === 'post') return 0;
  if (g.state !== 'in' || g.period <= 0) return 99999;
  if (g.period > 2) return 0;      // overtime: nothing left on the regulation clock
  if (isHalftime(g)) return HALF_SECONDS;
  return (2 - g.period) * HALF_SECONDS + g.clock;
}

function diff(g) { return Math.abs(g.home.score - g.away.score); }
function tier(g) { return Math.max(1, Math.ceil(diff(g) / TIER_SIZE)); }

// Minutes left to play. Same as secondsLeft for regulation, but in overtime that returns 0
// (nothing left of the REGULATION clock) and reach would collapse to a possession, so an
// overtime game reads the clock of the overtime period it is actually in.
function minutesLeft(g) {
  if (g.state !== 'in') return 0;
  if (g.period > 2) return g.clock / 60;
  return secondsLeft(g) / 60;
}

function reachOf(g) {
  const total = g.home.score + g.away.score;
  return Math.min(
    Math.max(total / REACH_DIV, REACH_FLOOR),
    REACH_CAP,
    REACH_PER_MIN * minutesLeft(g) + REACH_BASE);
}
// How far out of reach this game is. Half a point for a tie, so it never divides to zero
// and a tied game still sorts above a one-point game.
function reachRatio(g) { return Math.max(diff(g), 0.5) / reachOf(g); }

// The band a game sits in, with the slack applied. Sticky per game: the value only moves
// when the game clears the next line by BAND_SLACK. Kept in memory only - after a reload a
// game simply starts from its true band, which is where it would have settled anyway.
const bandState = new Map(); // game id -> the band currently being shown
function bandOf(g) {
  const a = reachRatio(g);
  let raw = BAND_CUTS.length;
  for (let i = 0; i < BAND_CUTS.length; i++) { if (a <= BAND_CUTS[i]) { raw = i; break; } }
  const prev = bandState.get(g.id);
  if (prev === undefined) { bandState.set(g.id, raw); return raw; }
  let band = prev;
  if (raw < prev) {
    if (a <= BAND_CUTS[raw] * (1 - BAND_SLACK)) band = raw;        // moving up: clear the line
  } else if (raw > prev) {
    const line = prev < BAND_CUTS.length ? BAND_CUTS[prev] : Infinity;
    if (a >= line * (1 + BAND_SLACK)) band = raw;                  // slipping back: same
  }
  bandState.set(g.id, band);
  return band;
}
function secondHalf(g) { return isLive(g) && (g.period >= 2 || isHalftime(g)); }

function favorite(g) {
  if (!g.spread || !g.spread.favId) return null;
  return g.spread.favId === g.home.id ? g.home : g.away;
}
function underdog(g) {
  const f = favorite(g);
  return f ? (f === g.home ? g.away : g.home) : null;
}
function favTrailing(g) {
  if (!g.spread || g.spread.points <= UPSET_MIN_SPREAD) return false;
  const fav = favorite(g), dog = underdog(g);
  return !!fav && fav.score < dog.score;
}

// ---------- flashing alerts ----------
function isUpsetAlert(g) {
  return isLive(g) && favTrailing(g) && secondsLeft(g) < UPSET_ALERT_SECONDS;
}
function isCloseGame(g) {
  return isLive(g) && diff(g) <= CLOSE_MAX_DIFF && secondsLeft(g) < CLOSE_SECONDS_LEFT;
}

// ---------- quieter watches (tinted edge, no pulse) ----------
function isUpsetWatch(g) {
  return isLive(g) && favTrailing(g) && secondsLeft(g) < UPSET_WATCH_AFTER;
}
function isGoodGameWatch(g) {
  return secondHalf(g) && diff(g) <= GOOD_GAME_DIFF && !!pollRankOf(g.home) && !!pollRankOf(g.away);
}
function isBlowoutWatch(g) {
  return isLive(g) && !!g.spread && g.spread.points <= BLOWOUT_MAX_SPREAD && diff(g) >= BLOWOUT_MIN_LEAD;
}

// A team that led by a lot has given most of it back: their lead has shrunk by COMEBACK_CUT
// or more (going from ahead to behind counts) and the game is now close.
function comebackQualifies(g) {
  if (!isLive(g) || diff(g) > COMEBACK_MAX_DIFF) return false;
  const peak = peakLeads[g.id];
  if (!peak || !peak.teamId) return false;
  const leadNow = peak.teamId === g.home.id ? g.home.score - g.away.score : g.away.score - g.home.score;
  return peak.lead - leadNow >= COMEBACK_CUT;
}
// The watch switches off if the comeback stalls: once on, the game's tier is tracked and the
// moment it climbs back above the closest tier it reached, the tint is dropped. It only
// re-arms if the game later gets closer than it ever was during the last run.
const comebackState = store.get('cb', {}); // game id -> { on, minTier, at }
function isComebackWatch(g) {
  const st = comebackState[g.id] || { on: false, minTier: Infinity, at: Date.now() };
  const t = tier(g);
  if (!comebackQualifies(g)) {
    st.on = false;
  } else if (st.on) {
    if (t < st.minTier) st.minTier = t;
    else if (t > st.minTier) st.on = false; // stalled: went back up a tier
  } else if (t < st.minTier) {
    st.on = true; st.minTier = t;
  }
  st.at = Date.now();
  comebackState[g.id] = st;
  return st.on;
}

// Postponement or stoppage. Basketball has no weather delays but ESPN uses the same status
// names for arena problems and postponements.
function isDelayed(g) {
  return g.state !== 'post' && /DELAY|SUSPEND|HALT|POSTPONE/.test(g.statusName);
}

// ---------- final-game tints ----------
function winner(g) {
  return g.state === 'post' && g.home.score !== g.away.score
    ? (g.home.score > g.away.score ? g.home : g.away) : null;
}
function isUpsetWin(g) {
  const w = winner(g), fav = favorite(g);
  return !!w && !!fav && g.spread.points > UPSET_WIN_MIN_SPREAD && w !== fav;
}
function isCloseCall(g) {
  const w = winner(g), fav = favorite(g);
  return !!w && !!fav && w === fav
    && g.spread.points >= CLOSE_CALL_MIN_SPREAD && diff(g) <= CLOSE_CALL_MAX_DIFF;
}
function isBlowoutWin(g) {
  const w = winner(g), fav = favorite(g);
  if (!w || !g.spread) return false;
  // Compare RAW POINTS, not tiers. Bucketing each side first made the answer depend on
  // which side of a boundary the line happened to fall.
  const projected = fav ? (w === fav ? g.spread.points : -g.spread.points) : 0;
  return diff(g) >= BLOWOUT_WIN_MIN_DIFF && diff(g) - projected >= BLOWOUT_WIN_MARGIN;
}
// Two ways in, because a game this app never watched live has no in-half lead history:
// the tracked deficit, or (always available) the halftime box score.
function isComebackWin(g) {
  const w = winner(g);
  if (!w) return false;
  const peak = peakLeads[g.id];
  if (peak && peak.teamId && peak.teamId !== w.id && peak.lead >= COMEBACK_WIN_DEFICIT) return true;
  const hl = g.home.lines, al = g.away.lines;
  if (hl.length < 1 || al.length < 1) return false;
  const deficitAtHalf = w === g.home ? al[0] - hl[0] : hl[0] - al[0];
  return deficitAtHalf >= COMEBACK_WIN_HALF;
}

// ESPN flags games "in progress" before they actually tip, so a brand-new game would
// otherwise rocket to the top as a 0-0 one-possession game. Hold it at the bottom of Live
// for the first two minutes of game clock instead.
function isNewGame(g) {
  return isLive(g) && g.period <= 1 && g.clock >= NEW_GAME_CLOCK;
}

// Around the half ESPN's clock flips between 0:00 and 20:00 (and the period number can lag
// or lead), which briefly scrambles the time-left math. Games in that state keep whatever
// spot they already had. Halftime and overtime read 0:00 legitimately.
function isClockUnstable(g) {
  if (!isLive(g) || g.period < 1 || g.period > 2 || isHalftime(g)) return false;
  return g.clock === 0 || g.clock === HALF_SECONDS;
}

function bestRanks(g) {
  return [rankOf(g.home, g) || 99, rankOf(g.away, g) || 99].sort((a, b) => a - b);
}

function compareGames(a, b) {
  const bucket = g => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);
  const ba = bucket(a), bb = bucket(b);
  if (ba !== bb) return ba - bb;

  if (ba === 0) {
    // Live: starred first, then how far out of reach the game is, then least time left,
    // then margin. g.band is set once per render (see renderGames) rather than computed
    // here, because the comparator runs many times per sort.
    return isFavoriteGame(b) - isFavoriteGame(a)
      || a.band - b.band || secondsLeft(a) - secondsLeft(b) || diff(a) - diff(b);
  }
  const fav = isFavoriteGame(b) - isFavoriteGame(a);
  if (ba === 1) {
    // Upcoming: tip-off, then smallest spread, then better-ranked matchup.
    const sa = a.spread ? a.spread.points : Infinity;
    const sb = b.spread ? b.spread.points : Infinity;
    const [a1, a2] = bestRanks(a), [b1, b2] = bestRanks(b);
    return fav || a.date - b.date || sa - sb || a1 - b1 || a2 - b2;
  }
  return fav || b.date - a.date; // Finals: most recent tip first
}

// ---------- rendering ----------
const els = {
  lists: { in: byId('list-live'), pre: byId('list-pre'), post: byId('list-post') },
  groups: { in: byId('group-live'), pre: byId('group-pre'), post: byId('group-post') },
  empty: byId('empty'),
  error: byId('error'),
  updated: byId('updated'),
  dateSelect: byId('date-select'),
  datePrev: byId('date-prev'),
  dateNext: byId('date-next'),
  refreshBtn: byId('refresh-btn'),
  chips: Array.from(document.querySelectorAll('.chip[data-conf]')),
  chipAll: byId('chip-all'),
  favTeamsBtn: byId('fav-teams-btn'),
  panel: byId('panel'),
  panelBack: byId('panel-back'),
  panelClose: byId('panel-close'),
  panelTitle: byId('panel-title'),
  panelBody: byId('panel-body'),
  panelFoot: byId('panel-foot'),
};
function byId(id) { return document.getElementById(id); }

const cardEls = new Map(); // game id -> { el, html }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// The second line (weekday + date) only appears when a game does not fall on the day being
// looked at. Football compared against TODAY, which is right for a week-based board; here
// the board IS a date, so a game is "normal" when it lands on the date you selected.
function fmtTipoff(d) {
  const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const onBoardDay = key === (selectedDate || currentDate || localDateKey());
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = onBoardDay ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
  return { time, day };
}

function periodLabel(g) {
  if (isHalftime(g)) return 'Half';
  if (g.period > 2) return g.period === 3 ? 'OT' : `${g.period - 2}OT`;
  if (isEndOfPeriod(g)) return g.period === 1 ? 'End 1st' : 'End 2nd';
  return g.period === 1 ? '1st' : '2nd';
}

function statusHtml(g) {
  if (g.state === 'pre') {
    const { time, day } = fmtTipoff(g.date);
    const off = /DELAY|POSTPONE|CANCEL/.test(g.statusName) ? `<span class="clock">${esc(g.statusDetail)}</span>` : '';
    return `<span class="q">${esc(time)}</span>${day ? `<span class="day">${esc(day)}</span>` : ''}${off}`;
  }
  if (g.state === 'post') {
    const ot = g.period > 2 ? (g.period === 3 ? '/OT' : `/${g.period - 2}OT`) : '';
    return `<span class="q">Final${ot}</span>`;
  }
  if (isDelayed(g)) {
    return `<span class="q">Delayed</span><span class="clock">${esc(g.period ? `${periodLabel(g)} ${g.displayClock}` : g.statusDetail)}</span>`;
  }
  const label = periodLabel(g);
  const showClock = !/Half|End/.test(label) && !(g.period > 2 && g.clock === 0);
  return `<span class="q">${esc(label)}</span>${showClock ? `<span class="clock">${esc(g.displayClock)}</span>` : ''}`;
}

function teamHtml(t, g, opponent) {
  const loser = g.state === 'post' && t.score < opponent.score;
  const r = rankInfo(t, g);
  const rank = r
    ? `<span class="rank${r.seed ? ' seed' : ''}"${r.seed ? ' title="Seed"' : ''}>${r.seed ? `(${r.rank})` : `#${r.rank}`}</span>`
    : '<span class="rank"></span>';
  return `<div class="team${loser ? ' loser' : ''}">
    <img src="${esc(t.logo)}" alt="" loading="lazy">
    ${rank}
    <span class="name" title="${esc(t.full)}">${esc(t.name)}</span>
    <span class="rec">${esc(t.record)}</span>
    <span class="score">${t.score}</span>
  </div>`;
}

function tierLabel(g) {
  const t = tier(g);
  return t <= 3 ? `${t} Poss` : '';
}

function spreadText(g) {
  if (!g.spread) return 'No line';
  if (!g.spread.favId) return 'PK';
  const fav = favorite(g);
  return `${fav.abbr} -${g.spread.points}`;
}

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z"/></svg>';

function runHtml(run) {
  return `<div class="runline">
    <span class="run">${run.points}-0 run</span>
    <span class="run-team">${esc(run.abbr)}</span>
  </div>`;
}

function cardHtml(g, flags, fav) {
  const badges = [];
  if (flags.delayed) badges.push('<span class="badge delayed">Delayed</span>');
  if (flags.upset) badges.push('<span class="badge upset">Upset alert</span>');
  if (flags.close) badges.push('<span class="badge close">Close game</span>');
  if (flags.upsetWatch && !flags.upset) badges.push('<span class="badge watch w-upsetWatch">Upset watch</span>');
  // Close game already says "one possession, late" - no need to say a near-identical thing twice.
  if (flags.goodGame && !flags.close) badges.push('<span class="badge watch w-goodGame">Ranked close game</span>');
  if (flags.comeback) badges.push('<span class="badge watch w-comeback">Comeback watch</span>');
  if (flags.blowout) badges.push('<span class="badge watch w-blowout">Blowout watch</span>');
  if (flags.upsetWin) badges.push('<span class="badge watch w-upsetWin">Upset</span>');
  if (flags.comebackWin) badges.push('<span class="badge watch w-comebackWin">Comeback win</span>');
  if (flags.closeCall) badges.push('<span class="badge watch w-closeCall">Close call</span>');
  if (flags.blowoutWin) badges.push('<span class="badge watch w-blowoutWin">Blowout win</span>');
  if (flags.newGame) badges.push('<span class="badge new">Just tipped</span>');
  return `
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    <button class="star${fav ? ' on' : ''}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fav}">${STAR_SVG}</button>
    <div class="teams">
      ${teamHtml(g.away, g, g.home)}
      ${teamHtml(g.home, g, g.away)}
    </div>
    <div class="status">${statusHtml(g)}</div>
    ${isLive(g) && g.run && !flags.delayed ? runHtml(g.run) : ''}
    <div class="meta">
      <span class="spread">${esc(spreadText(g))}</span>
      ${isLive(g) && tierLabel(g) ? `<span class="tier">${tierLabel(g)}</span>` : ''}
      ${g.round ? `<span class="round">${esc(g.round)}</span>` : ''}
      <span class="tv">${esc(g.tv || 'TV TBD')}</span>
    </div>`;
}

// Live-list order from the previous render, so games with an unstable clock can hold their
// spot, and the on-screen positions of every card, so reorders can be animated.
let prevLiveOrder = new Map(); // game id -> index within the live list
let hasRendered = false;
let suppressNextSlide = false; // set when the tab comes back from the background

// Tint priority when several apply: upset > good game > comeback > blowout,
// and for finals: upset > comeback win > close call > blowout win.
const WATCH_ORDER = ['upsetWatch', 'goodGame', 'comeback', 'blowout'];
const FINAL_ORDER = ['upsetWin', 'comebackWin', 'closeCall', 'blowoutWin'];

function orderLive(live) {
  // A starred game that is actually being played always sorts normally (and so leads the
  // list): neither the new-game hold nor the half-break freeze may push it down. Only a
  // delay, where play has stopped, can move a favourite off the top.
  const held = g => !isFavoriteGame(g);
  const delayed = live.filter(isDelayed).sort((a, b) => a.date - b.date);
  const newGames = live.filter(g => !isDelayed(g) && held(g) && isNewGame(g)).sort((a, b) => a.date - b.date);
  const frozen = live.filter(g => !isDelayed(g) && held(g) && !isNewGame(g) && isClockUnstable(g) && prevLiveOrder.has(g.id));
  const rest = live.filter(g => !delayed.includes(g) && !newGames.includes(g) && !frozen.includes(g)).sort(compareGames);
  for (const g of frozen.sort((a, b) => prevLiveOrder.get(a.id) - prevLiveOrder.get(b.id))) {
    rest.splice(Math.min(prevLiveOrder.get(g.id), rest.length), 0, g);
  }
  return rest.concat(newGames, delayed); // delayed games sit at the very bottom of Live
}

function renderGames(games) {
  // One pass before sorting: the band is sticky, so it must advance once per render and
  // not once per comparison.
  for (const g of games) g.band = isLive(g) ? bandOf(g) : 0;

  const visible = games.filter(g =>
    [...g.confKeys].some(k => filters.has(k))
    || (filters.has('fav') && isFavoriteGame(g))
    || (filters.has('top25') && isRankedGame(g)));

  const perBucket = { in: [], pre: [], post: [] };
  for (const g of visible) (perBucket[g.state] || perBucket.pre).push(g);
  perBucket.in = orderLive(perBucket.in);
  perBucket.pre.sort(compareGames);
  perBucket.post.sort(compareGames);
  prevLiveOrder = new Map(perBucket.in.map((g, i) => [g.id, i]));

  // Remember where every existing card sits before the DOM changes (FLIP animation).
  const animate = hasRendered && !suppressNextSlide && !document.hidden;
  const before = new Map();
  if (animate) for (const [id, entry] of cardEls) before.set(id, entry.el.getBoundingClientRect());
  suppressNextSlide = false;

  const seen = new Set();
  for (const state of ['in', 'pre', 'post']) {
    const list = els.lists[state];
    for (const g of perBucket[state]) {
      const delayed = isDelayed(g);
      const flags = {
        delayed, newGame: !delayed && isNewGame(g),
        // flashing alerts (suspended while delayed - nothing is happening)
        upset: !delayed && isUpsetAlert(g), close: !delayed && isCloseGame(g),
        // watches (tinted edge only), in priority order
        upsetWatch: !delayed && isUpsetWatch(g), goodGame: !delayed && isGoodGameWatch(g),
        comeback: !delayed && isComebackWatch(g), blowout: !delayed && isBlowoutWatch(g),
        // final-game tints
        upsetWin: isUpsetWin(g), comebackWin: isComebackWin(g),
        closeCall: isCloseCall(g), blowoutWin: isBlowoutWin(g),
      };
      const fav = isFavoriteGame(g);
      const html = cardHtml(g, flags, fav);
      let entry = cardEls.get(g.id);
      if (!entry) {
        const el = document.createElement('article');
        el.dataset.id = g.id;
        entry = { el, html: '' };
        cardEls.set(g.id, entry);
      }
      if (entry.html !== html) { entry.el.innerHTML = html; entry.html = html; }
      // Toggling classes (not rebuilding nodes) keeps the flash from restarting on every poll.
      // Flashing alerts beat every watch; among watches the first in WATCH_ORDER wins the
      // tint. Badges show everything that applies.
      const active = ['upset', 'close'].filter(k => flags[k]);
      const flash = active.length ? ` flash f-${active.join('-')}` : '';
      const watch = flash ? '' : ((g.state === 'post' ? FINAL_ORDER : WATCH_ORDER).find(k => flags[k]) || '');
      entry.el.className = `card ${g.state === 'in' ? 'live' : g.state}${flash}${watch ? ` watch w-${watch}` : ''}${flags.delayed ? ' delayed' : ''}${flags.newGame ? ' newgame' : ''}${entry.el.classList.contains('moving') ? ' moving' : ''}`;
      list.appendChild(entry.el); // appendChild moves an existing node, so this also reorders
      seen.add(g.id);
    }
    els.groups[state].hidden = perBucket[state].length === 0;
  }

  for (const [id, entry] of cardEls) {
    if (!seen.has(id)) { entry.el.remove(); cardEls.delete(id); }
  }
  els.empty.hidden = visible.length > 0;
  hasRendered = true;
  if (animate) slideMovedCards(before);
}

// Cards that changed position glide from where they were to where they are now, so a
// reorder is something you can watch rather than a jump cut.
function slideMovedCards(before) {
  for (const [id, entry] of cardEls) {
    const was = before.get(id);
    if (!was) continue; // brand-new card: just appears in place
    const now = entry.el.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    const el = entry.el;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.classList.add('moving');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `transform ${REORDER_MS}ms cubic-bezier(.25, .8, .25, 1)`;
      el.style.transform = '';
    }));
    clearTimeout(el._moveTimer);
    el._moveTimer = setTimeout(() => {
      el.style.transition = ''; el.style.transform = ''; el.classList.remove('moving');
    }, REORDER_MS + 50);
  }
}

function renderFilters() {
  for (const chip of els.chips) chip.classList.toggle('on', filters.has(chip.dataset.conf));
  els.chipAll.classList.toggle('on', filters.size === ALL_FILTERS.length);
}

// The legend is built from the threshold constants themselves, so the plain-English rules
// can never drift away from what the code actually does.
function renderLegend() {
  const mins = s => (s % 60 === 0 ? `${s / 60}:00` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  const rows = [
    ['Live games', [
      ['#c8102e', 'Upset alert', `(flashes) — favorite by more than ${UPSET_MIN_SPREAD} trailing with under ${mins(UPSET_ALERT_SECONDS)} left`],
      ['#2f6fd6', 'Close game', `(flashes) — within ${CLOSE_MAX_DIFF}, under ${mins(CLOSE_SECONDS_LEFT)} left`],
      ['#c8102e', 'Upset watch', `favorite by more than ${UPSET_MIN_SPREAD} trailing, any time after the first 5:00`],
      ['#2f6fd6', 'Ranked close game', `within ${GOOD_GAME_DIFF}, both teams ranked, second half`],
      ['#12925a', 'Comeback watch', `a lead has shrunk by ${COMEBACK_CUT}+ and the game is now within ${COMEBACK_MAX_DIFF}`],
      ['#c99700', 'Blowout watch', `line was ${BLOWOUT_MAX_SPREAD} or less, someone is up ${BLOWOUT_MIN_LEAD}+`],
      ['#f28c28', 'Delayed', 'stoppage or postponement; drops to the bottom of Live'],
    ]],
    ['Final games', [
      ['#c8102e', 'Upset', `an underdog of more than ${UPSET_WIN_MIN_SPREAD} won`],
      ['#12925a', 'Comeback win', `the winner came back from ${COMEBACK_WIN_DEFICIT}+ down, or trailed by ${COMEBACK_WIN_HALF}+ at the half`],
      ['#2f6fd6', 'Close call', `a favorite of ${CLOSE_CALL_MIN_SPREAD}+ survived by ${CLOSE_CALL_MAX_DIFF} or less`],
      ['#c99700', 'Blowout win', `won by ${BLOWOUT_WIN_MIN_DIFF}+ <em>and</em> beat the spread by ${BLOWOUT_WIN_MARGIN} or more`],
    ]],
  ];
  byId('legend').innerHTML = rows.map(([head, items]) =>
    `<h3>${head}</h3>` + items.map(([c, name, rule]) =>
      `<span><i class="swatch" style="background:${c}"></i> <b>${name}</b> — ${rule}</span>`).join('')
  ).join('')
    + `<p class="fine">Thresholds calibrated on 3,226 completed D1 games, Jan–Mar 2026.
       Hold the Top 25 chip to switch polls. Scores and lines from ESPN.</p>`;
}

// ---------- fetching ----------
let games = [];
let lastFetched = null;
let pollTimer = null;
let inflight = false;
let refetchWanted = false; // date changed while a fetch was in flight

async function checkForNewBuild() {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { v } = await res.json();
    if (!v || v === APP_VERSION) return;
    if (sessionStorage.getItem('qbbm_reloaded_for') === v) return; // one attempt per build, never a loop
    sessionStorage.setItem('qbbm_reloaded_for', v);
    // Not location.reload(): the iOS home-screen app can answer that from its cached copy of
    // index.html, which still points at the old script. A new query string forces a real fetch.
    const url = new URL(location.href);
    url.searchParams.set('v', v);
    location.replace(url);
  } catch { /* offline or blocked: ignore */ }
}

async function backfillSpreads(list) {
  const now = Date.now();
  // Pregame lines still arrive through the scoreboard itself, so only chase live/final games.
  // Essentially every D1 game is priced (3,226 of 3,237 in the calibration sample).
  const missing = list.filter(g => !g.spread && g.state !== 'pre'
    && now - (oddsAttempts.get(g.id) || 0) > ODDS_RETRY_MS);
  if (!missing.length) return;
  for (const g of missing) oddsAttempts.set(g.id, now);
  let found = false;
  const CHUNK = 6;
  for (let i = 0; i < missing.length; i += CHUNK) {
    await Promise.allSettled(missing.slice(i, i + CHUNK).map(async g => {
      const res = await fetch(ODDS_URL(g.id), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const items = (await res.json()).items || [];
      const o = items.find(it => it.provider && it.provider.id === '100') || items[0]; // prefer DraftKings
      const spread = spreadFromOdds(o, g.home, g.away);
      if (spread) { spreadCache[g.id] = spread; g.spread = spread; found = true; }
    }));
  }
  if (found) {
    store.set('spreads', spreadCache);
    renderGames(games);
  }
}

async function refresh() {
  if (inflight) { refetchWanted = true; return; }
  inflight = true;
  els.refreshBtn.classList.add('spin');
  checkForNewBuild();
  try {
    const requested = selectedDate;
    loadRankings(false); // async; the next render picks it up
    const res = await fetch(scoreboardUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
    const data = await res.json();
    if (requested !== selectedDate) return; // user changed dates while this was in flight
    games = (data.events || []).map(parseEvent).filter(Boolean);
    if (DEMO) games = applyDemo(games);
    store.set('spreads', spreadCache);
    pruneState();
    store.set('peaks', peakLeads);
    store.set('runs', runs);
    store.set('cb', comebackState);
    lastFetched = new Date();
    // eventsDate tells us which day ESPN actually served, which is how a plain visit
    // (no ?date=) learns what "today" is without guessing from the device's time zone.
    const served = ((data.eventsDate || {}).date || '').slice(0, 10).replace(/-/g, '');
    if (served) currentDate = served;
    buildCalendar(data);
    renderDateSelect();
    byId('demo-badge').hidden = !DEMO;
    els.error.hidden = true;
    renderGames(games);
    backfillSpreads(games); // async; re-renders when lines arrive
  } catch (err) {
    els.error.textContent = `Could not load scores: ${err.message}`;
    els.error.hidden = false;
  } finally {
    inflight = false;
    els.refreshBtn.classList.remove('spin');
    updateStamp();
    schedule();
    if (refetchWanted) { refetchWanted = false; refresh(); }
  }
}

// ---------- date picker ----------
// leagues[0].calendar is a flat array of every date ESPN has D1 games for
// (calendarType "day", calendarIsWhitelist true). It covers the regular season only -
// the NCAA tournament dates are not in it - so the dropdown always also offers today and
// whatever date is selected, and the arrows step a plain calendar day either way.
function buildCalendar(data) {
  const league = (data.leagues || [])[0];
  const list = (league && league.calendar) || [];
  if (!list.length) return;
  const seen = new Set(calendar);
  for (const iso of list) {
    const d = String(iso).slice(0, 10).replace(/-/g, '');
    if (/^\d{8}$/.test(d) && !seen.has(d)) { calendar.push(d); seen.add(d); }
  }
  calendar.sort();
}

// The device's own date. ESPN's eventsDate is NOT this: on a day with no games it hands
// back the next date that has some, so labelling that "Today" would be a lie.
function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateKey(key) {
  const d = new Date(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T12:00:00`);
  const pretty = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return key === localDateKey() ? `Today · ${pretty}` : pretty;
}

function shiftDate(key, days) {
  const d = new Date(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function renderDateSelect() {
  const active = selectedDate || currentDate;
  // The arrows do date arithmetic, so they stay disabled until we know which day we are on.
  els.datePrev.disabled = els.dateNext.disabled = !active;
  if (!active) { els.dateSelect.innerHTML = '<option>Today</option>'; return; }
  const keys = [...new Set([...calendar, active, currentDate].filter(Boolean))].sort();
  els.dateSelect.innerHTML = keys.map(k =>
    `<option value="${k}"${k === active ? ' selected' : ''}>${esc(fmtDateKey(k))}</option>`).join('');
}

function goToDate(key) {
  if (!key) return;
  selectedDate = key === currentDate ? null : key; // today keeps a clean URL
  const url = new URL(location.href);
  if (selectedDate) url.searchParams.set('date', selectedDate); else url.searchParams.delete('date');
  history.replaceState(null, '', url);
  games = [];
  for (const [, entry] of cardEls) entry.el.remove();
  cardEls.clear();
  hasRendered = false;
  els.updated.textContent = 'Loading…';
  refresh();
}

function schedule() {
  clearTimeout(pollTimer);
  const anyLive = games.some(isLive);
  pollTimer = setTimeout(refresh, anyLive ? LIVE_POLL_MS : IDLE_POLL_MS);
}

function updateStamp() {
  if (!lastFetched) return;
  const secs = Math.round((Date.now() - lastFetched) / 1000);
  els.updated.textContent = secs < 5 ? 'Updated just now' : `Updated ${secs}s ago`;
}
setInterval(updateStamp, 1000);

// ---------- demo mode (?demo) ----------
// Fakes a mid-evening slate so the sorting and every alert state can be seen without
// waiting for a real game night. Real teams and lines are used; only states change.
function applyDemo(list) {
  const out = list.map(g => ({ ...g, home: { ...g.home }, away: { ...g.away } }));
  // ESPN only prices games a few days out, so on most dates the real feed has no lines at
  // all - and without a line the upset, blowout and close-call states can never be seen.
  // Give every unpriced game a stable fake line derived from its id, so ?demo exercises
  // the whole board on any date of the year.
  for (const g of out) {
    if (g.spread) continue;
    const n = Number(String(g.id).slice(-3)) || 0;
    const points = 1.5 + (n % 13);                     // 1.5 ... 13.5
    g.spread = { favId: n % 2 ? g.home.id : g.away.id, points, details: 'demo' };
  }
  const pre = out.filter(g => g.state === 'pre');
  const setClock = (g, clock) => {
    g.clock = clock;
    g.displayClock = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
  };
  const scripts = [
    // [period, clockSeconds, statusName, awayScore, homeScore]
    [2, 95,   'STATUS_IN_PROGRESS', 68, 70], // close game, underdog pushed ahead below
    [2, 38,   'STATUS_IN_PROGRESS', 71, 69],
    [2, 540,  'STATUS_IN_PROGRESS', 55, 58],
    [2, 300,  'STATUS_IN_PROGRESS', 51, 70],
    [1, 0,    'STATUS_HALFTIME',    31, 38],
    [3, 160,  'STATUS_IN_PROGRESS', 78, 78], // overtime
    [1, 820,  'STATUS_IN_PROGRESS', 18, 22],
    [2, 760,  'STATUS_IN_PROGRESS', 38, 61],
    [2, 15,   'STATUS_IN_PROGRESS', 64, 64],
    [1, 420,  'STATUS_IN_PROGRESS', 29, 20],
    [2, 380,  'STATUS_IN_PROGRESS', 60, 62], // comeback watch: home led by 20, now by 2
    [1, 1140, 'STATUS_IN_PROGRESS', 2, 0],   // just tipped: 19:00 of the 1st half
    [1, 0,    'STATUS_END_PERIOD',  33, 35], // unstable clock: holds its spot
  ];
  pre.slice(0, scripts.length).forEach((g, i) => {
    const [period, clock, statusName, a, h] = scripts[i];
    g.state = 'in'; g.period = period; g.statusName = statusName; g.statusDetail = '';
    setClock(g, clock);
    // Put the underdog ahead in the first two so an upset alert shows if the line is big enough.
    const fav = favorite(g);
    if (i < 2 && fav) {
      const dogIsHome = fav === g.away;
      g.home.score = dogIsHome ? Math.max(a, h) : Math.min(a, h);
      g.away.score = dogIsHome ? Math.min(a, h) : Math.max(a, h);
    } else { g.away.score = a; g.home.score = h; }
    if (i === 10) peakLeads[g.id] = { teamId: g.home.id, lead: 22, at: Date.now() };
    if (i === 2) g.run = { points: 9, abbr: g.home.abbr };
    if (i === 8) g.run = { points: 7, abbr: g.away.abbr };
  });
  pre.slice(scripts.length, scripts.length + 4).forEach((g, i) => {
    g.state = 'post'; g.period = 2; g.statusName = 'STATUS_FINAL';
    const fav = favorite(g) || g.home, dog = fav === g.home ? g.away : g.home;
    if (i === 0) {                                     // upset
      dog.score = 74; fav.score = 69;
      if (g.spread) g.spread = { ...g.spread, points: Math.max(g.spread.points, 9) };
    } else if (i === 1) {                              // comeback win
      fav.score = 77; dog.score = 73;
      peakLeads[g.id] = { teamId: dog.id, lead: 18, at: Date.now() };
      fav.lines = [28, 49]; dog.lines = [40, 33];
    } else if (i === 2) {                              // blowout win
      fav.score = 92; dog.score = 61;
      if (g.spread) g.spread = { ...g.spread, points: 4 };
    } else {                                           // close call
      fav.score = 70; dog.score = 67;
      if (g.spread) g.spread = { ...g.spread, points: 12 };
    }
  });
  // Targeted cases for the remaining watch tints, picked from whatever is left.
  const left = pre.slice(scripts.length + 4).filter(g => g.state === 'pre');
  const take = pred => { const i = left.findIndex(pred); return i >= 0 ? left.splice(i, 1)[0] : null; };
  const live = (g, period, clock, status = 'STATUS_IN_PROGRESS') => {
    g.state = 'in'; g.period = period; g.statusName = status; g.statusDetail = ''; setClock(g, clock);
  };
  let g;
  if ((g = take(x => x.spread && x.spread.points > UPSET_MIN_SPREAD))) { // upset watch, 1st half
    live(g, 1, 400);
    const fav = favorite(g), dog = fav === g.home ? g.away : g.home;
    fav.score = 24; dog.score = 31;
  }
  if ((g = take(x => pollRankOf(x.home) && pollRankOf(x.away)))) {       // ranked close game
    live(g, 2, 700); g.away.score = 52; g.home.score = 50;
  }
  if ((g = take(x => x.spread && x.spread.points <= BLOWOUT_MAX_SPREAD))) { // blowout watch
    live(g, 2, 640); g.away.score = 38; g.home.score = 61;
  }
  if ((g = take(() => true))) {                                          // stoppage
    live(g, 2, 512, 'STATUS_DELAYED'); g.away.score = 44; g.home.score = 47;
  }
  return out;
}

// ---------- Favorite Teams panel ----------
// One request gets every D1 team: the standings tree for group 50 at level 3 returns all 31
// conferences with their rosters, so the picker is built locally rather than per conference.
const STANDINGS_URL =
  'https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?group=50&level=3';
const TEAM_CATEGORIES = [
  { key: 'sec', label: 'SEC', confIds: ['23'] },
  { key: 'b1g', label: 'Big Ten', confIds: ['7'] },
  { key: 'b12', label: 'Big 12', confIds: ['8'] },
  { key: 'acc', label: 'ACC', confIds: ['2'] },
  { key: 'be', label: 'Big East', confIds: ['4'] },
  { key: 'mid', label: 'Every other conference', confIds: null }, // null = whatever is left
];
const TEAMS_TTL_MS = 7 * 24 * 3600 * 1000;
let allConfs = null; // [{ id, conf, teams: [...] }] for all of D1

function walkStandings(node, out, confName, confId) {
  const entries = (node.standings && node.standings.entries) || [];
  const name = node.name || confName || '';
  const id = node.id || confId || '';
  if (entries.length) {
    out.push({
      id: String(id), conf: name,
      teams: entries.map(e => e.team).map(t => ({
        id: String(t.id),
        name: t.shortDisplayName || t.displayName,
        full: t.displayName,
        abbr: t.abbreviation || '',
        logo: (t.logos && t.logos[0] && t.logos[0].href) || '',
        conf: name,
      })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  for (const child of node.children || []) walkStandings(child, out, name, node.id || confId);
}

async function loadAllConfs() {
  if (allConfs) return allConfs;
  const cached = store.get('teams', null);
  if (cached && Date.now() - cached.at < TEAMS_TTL_MS) { allConfs = cached.confs; return allConfs; }
  const res = await fetch(STANDINGS_URL);
  if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
  const out = [];
  walkStandings(await res.json(), out);
  allConfs = out.sort((a, b) => a.conf.localeCompare(b.conf));
  store.set('teams', { at: Date.now(), confs: allConfs });
  return allConfs;
}

async function loadCategory(cat) {
  const confs = await loadAllConfs();
  if (cat.confIds) return confs.filter(c => cat.confIds.includes(c.id));
  const major = new Set(Object.keys(CONF_KEYS));
  return confs.filter(c => !major.has(c.id));
}

let panelView = 'list';   // list | cats | teams
let panelCat = null;
let panelQuery = '';
let panelSections = [];   // what the team picker is currently showing

function openPanel() {
  showPanelView('list');
  els.panel.hidden = false;
  document.body.classList.add('panel-open');
}
function closePanel() {
  els.panel.hidden = true;
  document.body.classList.remove('panel-open');
}

function showPanelView(view, cat) {
  panelView = view;
  if (cat) panelCat = cat;
  els.panelBack.hidden = view === 'list';
  els.panelTitle.textContent = view === 'list' ? 'Favorite Teams'
    : view === 'cats' ? 'Add New Favorite Team' : panelCat.label;
  els.panelFoot.innerHTML = view === 'list'
    ? '<button class="btn-primary" id="add-team-btn">Add New Favorite Team</button>' : '';
  els.panelBody.scrollTop = 0;
  if (view === 'list') renderFavList();
  else if (view === 'cats') renderCategories();
  else renderTeamPicker();
}

function teamRow(t, starred) {
  return `<li data-team="${esc(t.id)}">
    <img src="${esc(t.logo)}" alt="" loading="lazy">
    <div class="grow"><span class="t-name">${esc(t.full || t.name)}</span><span class="t-conf">${esc(t.conf)}</span></div>
    <button class="star inline${starred ? ' on' : ''}" aria-pressed="${starred}" aria-label="${starred ? 'Remove favorite' : 'Add favorite'}">${STAR_SVG}</button>
  </li>`;
}

function renderFavList() {
  if (!favTeams.length) {
    els.panelBody.innerHTML = `<p class="panel-empty">No favorite teams yet.<br>Games your favorite teams play are starred automatically every night and jump to the top while live.</p>`;
    return;
  }
  const sorted = [...favTeams].sort((a, b) => a.name.localeCompare(b.name));
  els.panelBody.innerHTML = `<p class="panel-note">Their games are starred automatically every night.</p>
    <ul class="team-list">${sorted.map(t => teamRow(t, true)).join('')}</ul>`;
}

function renderCategories() {
  const counts = {};
  for (const t of favTeams) counts[t.cat] = (counts[t.cat] || 0) + 1;
  els.panelBody.innerHTML = `<div class="cat-list">${TEAM_CATEGORIES.map(c =>
    `<button class="cat-btn" data-cat="${c.key}"><span>${esc(c.label)}</span><span>${counts[c.key] ? `<span class="count">${counts[c.key]} ★</span>` : ''}<span class="chev">›</span></span></button>`
  ).join('')}</div>`;
}

async function renderTeamPicker() {
  const cat = panelCat;
  els.panelBody.innerHTML = `<input class="search" id="team-search" type="search" placeholder="Search teams" value="${esc(panelQuery)}" autocomplete="off">
    <p class="panel-empty">Loading teams…</p>`;
  let sections;
  try { sections = await loadCategory(cat); }
  catch (err) {
    els.panelBody.querySelector('.panel-empty').textContent = `Could not load teams: ${err.message}`;
    return;
  }
  if (panelView !== 'teams' || panelCat !== cat) return; // user navigated away meanwhile
  panelSections = sections;
  const ids = favTeamIds();
  const q = panelQuery.trim().toLowerCase();
  const html = sections.map(sec => {
    const teams = q ? sec.teams.filter(t => (t.full + ' ' + t.abbr).toLowerCase().includes(q)) : sec.teams;
    if (!teams.length) return '';
    return `${sections.length > 1 ? `<h3>${esc(sec.conf)}</h3>` : ''}${teams.map(t => teamRow(t, ids.has(t.id))).join('')}`;
  }).join('');
  const list = els.panelBody.querySelector('.panel-empty');
  list.outerHTML = html ? `<ul class="team-list">${html}</ul>` : '<p class="panel-empty">No teams match.</p>';
  const search = byId('team-search');
  search.addEventListener('input', () => { panelQuery = search.value; renderTeamPicker(); });
  if (q) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}

function toggleFavTeam(id) {
  const existing = favTeams.find(t => t.id === id);
  if (existing) {
    favTeams = favTeams.filter(t => t.id !== id);
  } else {
    const t = panelSections.flatMap(sec => sec.teams).find(x => x.id === id);
    if (!t) return;
    favTeams.push({ ...t, cat: panelCat.key });
  }
  saveFavTeams();
}

els.favTeamsBtn.addEventListener('click', openPanel);
els.panelClose.addEventListener('click', closePanel);
els.panelBack.addEventListener('click', () => showPanelView(panelView === 'teams' ? 'cats' : 'list'));
els.panel.addEventListener('click', e => {
  if (e.target.closest('#add-team-btn')) { panelQuery = ''; showPanelView('cats'); return; }
  const catBtn = e.target.closest('.cat-btn');
  if (catBtn) { panelQuery = ''; showPanelView('teams', TEAM_CATEGORIES.find(c => c.key === catBtn.dataset.cat)); return; }
  const star = e.target.closest('.star.inline');
  if (star) {
    const id = star.closest('li').dataset.team;
    toggleFavTeam(id);
    if (panelView === 'list') renderFavList();
    else { const on = favTeamIds().has(id); star.classList.toggle('on', on); star.setAttribute('aria-pressed', on); }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !els.panel.hidden) closePanel(); });
els.favTeamsBtn.classList.toggle('has-teams', favTeams.length > 0);

// Demo shuffle: every few seconds one live game scores or its clock runs, so the cards
// visibly trade places.
if (DEMO_SHUFFLE) {
  setInterval(() => {
    const live = games.filter(g => isLive(g) && !isNewGame(g) && g.period <= 2);
    if (live.length < 2) return;
    const g = live[Math.floor(Math.random() * live.length)];
    if (Math.random() < 0.6) {
      const team = Math.random() < 0.5 ? g.home : g.away;
      team.score += Math.random() < 0.6 ? 2 : 3;
    } else {
      g.clock = Math.max(1, g.clock - 120);
      g.displayClock = `${Math.floor(g.clock / 60)}:${String(g.clock % 60).padStart(2, '0')}`;
    }
    renderGames(games);
  }, 6000);
}

// ---------- pull to refresh ----------
// The home-screen app has no browser chrome, so a downward drag from the very top opens a
// strip under the header (title and chips stay put) showing an arrow; past the threshold
// it flips, and letting go refreshes.
{
  const el = byId('ptr'), icon = el.querySelector('.ptr-icon');
  const THRESHOLD = 60, MAX = 100;
  let startY = null, pulling = false, dist = 0;
  const reset = () => {
    el.classList.add('settle'); el.classList.remove('show', 'armed', 'loading');
    el.style.height = ''; icon.textContent = '↓'; dist = 0;
    setTimeout(() => el.classList.remove('settle'), 300);
  };
  document.addEventListener('touchstart', e => {
    pulling = window.scrollY <= 0 && e.touches.length === 1 && els.panel.hidden && !el.classList.contains('loading');
    startY = pulling ? e.touches[0].clientY : null; dist = 0;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { dist = 0; el.classList.remove('show', 'armed'); el.style.height = ''; return; }
    dist = Math.min(dy * 0.55, MAX); // some resistance
    el.classList.add('show');
    el.classList.toggle('armed', dist >= THRESHOLD);
    el.style.height = `${dist}px`;
  }, { passive: true });
  const release = () => {
    if (!pulling) return;
    pulling = false;
    if (dist < THRESHOLD) { reset(); return; }
    el.classList.remove('armed'); el.classList.add('loading'); icon.textContent = '↻';
    el.classList.add('settle'); el.style.height = '52px';
    Promise.resolve(refresh()).finally(() => setTimeout(reset, 350));
  };
  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
}

// ---------- wiring ----------
for (const chip of els.chips) {
  chip.addEventListener('click', () => {
    const k = chip.dataset.conf;
    if (filters.has(k)) filters.delete(k); else filters.add(k);
    if (filters.size === 0) filters = new Set(DEFAULT_FILTERS); // never leave an empty board
    store.set(FILTER_KEY, [...filters]);
    renderFilters();
    renderGames(games);
  });
}
els.chipAll.addEventListener('click', () => {
  filters = new Set(ALL_FILTERS);
  store.set(FILTER_KEY, [...filters]);
  renderFilters();
  renderGames(games);
});
els.refreshBtn.addEventListener('click', refresh);
byId('board').addEventListener('click', e => {
  const star = e.target.closest('.star');
  if (star) toggleFavorite(star.closest('.card').dataset.id);
});
els.dateSelect.addEventListener('change', () => goToDate(els.dateSelect.value));
els.datePrev.addEventListener('click', () => goToDate(shiftDate(selectedDate || currentDate, -1)));
els.dateNext.addEventListener('click', () => goToDate(shiftDate(selectedDate || currentDate, 1)));
// Top 25 chip: tap toggles the filter, hold (~450ms) or right-click opens the poll menu.
{
  const chip = byId('chip-top25');
  let holdTimer = null, held = false;
  const start = () => { held = false; clearTimeout(holdTimer); holdTimer = setTimeout(() => { held = true; openPollMenu(); }, 450); };
  const cancel = () => clearTimeout(holdTimer);
  chip.addEventListener('pointerdown', start);
  chip.addEventListener('pointerup', cancel);
  chip.addEventListener('pointerleave', cancel);
  chip.addEventListener('pointercancel', cancel);
  chip.addEventListener('click', e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
  chip.addEventListener('contextmenu', e => { e.preventDefault(); openPollMenu(); });
  byId('poll-menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-poll]');
    if (!b) return;
    selectedPoll = b.dataset.poll;
    store.set('poll', selectedPoll);
    renderPollSelect();
    closePollMenu();
    renderGames(games);
  });
  document.addEventListener('pointerdown', e => {
    if (!byId('poll-menu').hidden && !e.target.closest('#poll-menu') && !e.target.closest('#chip-top25')) closePollMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePollMenu(); });
}
renderPollSelect();
renderLegend();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { suppressNextSlide = true; refresh(); } // coming back is a fresh look, no slide show
});

renderFilters();
{ // drop the cache-busting ?v= once the matching build is running
  const url = new URL(location.href);
  if (url.searchParams.get('v') === APP_VERSION) { url.searchParams.delete('v'); history.replaceState(null, '', url); }
}
refresh();
