// Free Fall Frank, what this browser keeps (localStorage): what one build writes and the next build has to read.
// It has a version ('fff.v'), and it is read so that a new build can never take anything from a player:
//   v 1   everything kept before there were versions (no 'fff.v'): fff.did, fff.frank, fff.lv, fff.name, fff.tag,
//         fff.top.<level> and fff.far.<level> (his bests), fff.set (the settings, first without diff), fff.levels and
//         fff.franks (what players made that he has opened), fff.heart.<level>, fff.tokens (tokens earned offline,
//         waiting), fff.intro, fff.howto, fff.splash
//   v 2   the same, with 'fff.v', and what waits for the server in 'fff.outbox' (net.js) instead of fff.tokens
// A field this build does not know is kept as it is (a later build wrote it, and may be back after a rollback); one
// that is missing or makes no sense gets its usual value; and something that cannot be read at all is not wiped: its
// text is set aside under 'fff.bad.<name>' and he carries on with the usual values. Nothing here is ever taken away
// by what the server says: the server's word is only ever added to it (account.js, apply()).
// Loaded by the page before the game, and by the tests in Node.
(function (root) {
  'use strict';
  const V = 2, SET = { music: true, sfx: true, buzz: true, easy: false, diff: -1 };
  const box = function (s) { return s || root.localStorage; };
  function get(k, s) { try { return box(s).getItem(k); } catch (e) { return null; } }   // (private mode, or a frame with no storage: nothing is kept)
  function put(k, v, s) { try { box(s).setItem(k, String(v)); return true; } catch (e) { return false; } }
  // what could not be read is kept, whole, under a name of its own (the same text is kept once)
  function aside(k, text, s) {
    const name = 'fff.bad.' + k.replace(/^fff\./, '');
    for (let i = 1; i < 20; i++) { const n = i > 1 ? name + '.' + i : name, had = get(n, s); if (had === text) return n; if (had === null) { put(n, text, s); return n; } }
    return '';
  }
  // something kept as JSON: a list ('array') or a set of fields ('object'). Nothing there: the empty one.
  function json(k, kind, s) {
    const raw = get(k, s), none = kind === 'array' ? [] : {};
    if (raw === null || raw === '') return none;
    let v;
    try { v = JSON.parse(raw); } catch (e) { v = undefined; }
    if (kind === 'array' ? !Array.isArray(v) : !v || typeof v !== 'object' || Array.isArray(v)) { aside(k, raw, s); return none; }
    return v;
  }
  // the settings: every field this build knows with a value that makes sense, and any it does not know as it was
  function settings(s) {
    const out = Object.assign({}, SET, json('fff.set', 'object', s));
    ['music', 'sfx', 'buzz', 'easy'].forEach(function (k) { if (typeof out[k] !== 'boolean') out[k] = SET[k]; });
    if (!Number.isInteger(out.diff)) out.diff = -1;                 // (the game takes it from easy: from before there were four)
    return out;
  }
  // the made levels ('fff.levels') or Franks ('fff.franks') he has opened: each one a thing with an id, as it was kept
  function list(k, s) { return json(k, 'array', s).filter(function (m) { return !!m && typeof m === 'object' && typeof m.id === 'string'; }); }
  const num = function (k, s) { const n = +(get(k, s) || 0); return isFinite(n) ? n : 0; };
  // the version: written when there is none, and never made less (a later build's stays, after a rollback)
  function stamp(s) {
    const had = Math.floor(num('fff.v', s)) || 1;
    if (had < V || get('fff.v', s) === null) put('fff.v', Math.max(V, had), s);
    return had;
  }
  const api = { V: V, SET: SET, get: get, put: put, json: json, settings: settings, list: list, num: num, stamp: stamp, aside: aside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.FFFSave = api; api.was = stamp(); }
})(typeof window !== 'undefined' ? window : globalThis);
