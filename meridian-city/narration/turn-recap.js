// The recaps: when a decade's playback reaches its last year, and when the game ends (all decades), a pop-up over the map
// says in 2-3 sentences what the policies did (POST /api/narration with decade: { from, to }) and reads it aloud. Each pops
// up by itself only the first time in a session; after that the "Recap" launcher beside Residents reopens any of them, from
// the cached text and audio. A run with other cards (a new body) fetches anew. Voice is on unless the speaker button turned
// it off (remembered in localStorage). Without audio (the template, an API failure) the pop-up shows the text alone.
// It never blocks the map: no backdrop, and a click anywhere else closes it.
import { h } from '../policy/components.js';
import { withDeltas } from '../../shared/combined.js';
import { loadPlayerCards } from '../policy/player-cards.js';

/**
 * The narration body for the years `from` to `to` (since year 0) of a run (sim-worker.js's { result, noPolicy }): the last
 * year against the first and against no new policy. Pure, so scripts/pregen-demo.js hashes the same input as the page.
 */
export function recapBody({ result, noPolicy }, from, to, startYear) {
  const upTo = r => ({ timeline: r.timeline.slice(0, to + 1) });
  const deltas = (base, comparedWith) => withDeltas(upTo(result), base).deltas.map(d => ({ ...d, comparedWith }));
  return {
    policies: result.policies.map(({ id, params }) => ({ id, params })),
    years: to,
    decade: { from: startYear + from, to: startYear + to },
    deltas: [...deltas({ timeline: [result.timeline[from]] }, from ? 'start of decade' : 'year 0'), ...deltas(upTo(noPolicy), 'no new policy')],
  };
}

// When /api/narration can't be reached (or nothing is in force, which it doesn't take): the headline numbers.
const money = n => `$${Math.round(n).toLocaleString('en-US')}`, count = n => Math.round(n).toLocaleString('en-US');
export function fallbackText({ policies, decade, deltas }) {
  const at = m => deltas.find(d => d.metric === m && d.comparedWith !== 'no new policy');
  const parts = [['medianRent', 'median rent', money], ['housingUnits', 'homes', count], ['pricedOut', 'households priced out', count]]
    .filter(([m]) => at(m)).map(([m, label, f]) => `${label} went from ${f(at(m).baseline)} to ${f(at(m).final)}`);
  return `From ${decade.from} to ${decade.to}, with ${policies.length ? `${policies.length} ${policies.length === 1 ? 'policy' : 'policies'} in force` : 'no new policy'}, ${parts.join(', ')}.`;
}

const VOICE_KEY = 'prosperia.recapVoice';
const SPEAKER = 'M1 3h2v3H1zM3 2h1v5H3zM4 1h1v7H4z', WAVES = 'M6 3h1v3H6zM7 2h1v1H7zM7 6h1v1H7zM8 3h1v3H8z', CROSS = 'M6 3h1v1H6zM8 3h1v1H8zM7 4h1v1H7zM6 5h1v1H6zM8 5h1v1H8z';
const svg = d => `<svg viewBox="0 0 9 9" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;

/** @param {{ clock: any, game: any, host?: HTMLElement }} o */
export function mountTurnRecap({ clock, game, host = document.body }) {
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('./turn-recap.css', import.meta.url).href }));
  let voice = true;
  try { voice = localStorage.getItem(VOICE_KEY) !== 'off'; } catch {}

  const title = h('h2', { class: 'recap__title', id: 'recap-title' });
  const kicker = h('p', { class: 'recap__kicker' });
  const text = h('p', { class: 'recap__text', 'aria-live': 'polite' });
  const credit = h('p', { class: 'recap__credit' });
  const speaker = h('button', { class: 'tool-btn recap__speaker', type: 'button', onclick: () => setVoice(!voice) });
  const play = h('button', { class: 'tool-btn recap__play', type: 'button', onclick: () => start() }, '▶ Play');
  const close = h('button', { class: 'resident__close', type: 'button', 'aria-label': 'Close recap', onclick: () => hide() }, '×');
  const box = h('section', { class: 'plate recap', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'recap-title', hidden: true },
    h('header', { class: 'recap__head' }, title, speaker, close), kicker, text, h('div', { class: 'recap__actions' }, play), credit);
  // The launcher: reopens the latest recap; with more than one, a picker opens any of them.
  const reopen = h('button', { class: 'pp-launch recap-launch__btn', type: 'button', 'aria-haspopup': 'dialog', onclick: () => open(pick.value) });
  const pick = h('select', { class: 'recap-launch__pick', 'aria-label': 'Pick a recap', onchange: () => open(pick.value) });
  const launcher = h('div', { class: 'recap-launch', hidden: true }, reopen, pick);
  host.append(box, launcher);
  // beside the Residents button
  const place = () => { const r = document.getElementById('resident-launch')?.getBoundingClientRect(); if (r?.width) Object.assign(launcher.style, { left: `${r.right + 8}px`, top: `${r.top}px` }); };
  addEventListener('resize', place);

  const audio = new Audio();
  const sync = () => {
    play.hidden = !audio.src || !audio.paused;
    speaker.hidden = !audio.src;
    speaker.innerHTML = svg(SPEAKER + (voice ? WAVES : CROSS));
    speaker.setAttribute('aria-pressed', String(voice));
    speaker.setAttribute('aria-label', voice ? 'Voice on: turn off' : 'Voice off: turn on');
    speaker.title = voice ? 'Voice on (click to mute)' : 'Voice off (click to read it aloud)';
  };
  audio.onplay = audio.onpause = audio.onended = sync;
  const start = () => audio.play().catch(err => { console.warn('recap: audio did not play', err); sync(); });
  const stop = () => { audio.pause(); audio.currentTime = 0; };
  function setVoice(on) {
    voice = on;
    try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch {}
    if (on) start(); else stop();
    sync();
  }

  const recaps = new Map(); // '1', '2', '3' (decades), 'game' -> { label, body } from the latest run played to the end
  const fetched = new Map(); // JSON body -> Promise<{ text, audio, fallback }>; a failure is dropped so a reopen retries
  function load(body) {
    if (!body.policies.length) return Promise.resolve({ text: fallbackText(body), audio: null, fallback: true });
    const ids = new Set(body.policies.map(p => p.id)), cards = loadPlayerCards().filter(e => ids.has(e.card.id)); // drafted cards, signed
    const send = cards.length ? { ...body, cards } : body, key = JSON.stringify(send);
    if (!fetched.has(key)) fetched.set(key, fetch('/api/narration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: key })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(r => { if (r.fallback) fetched.delete(key); return r; }) // the template (Gemini failed): a reopen asks again
      .catch(err => { console.error('recap:', err); fetched.delete(key); return { text: fallbackText(body), audio: null, fallback: true }; }));
    return fetched.get(key);
  }

  let opened = 0; // which open() is current, so a slow reply never lands in a closed or newer pop-up
  async function open(key) {
    const id = ++opened, { label, body } = recaps.get(key);
    pick.value = key; reopen.textContent = label;
    stop(); audio.removeAttribute('src');
    title.textContent = label;
    kicker.textContent = credit.textContent = text.textContent = '';
    box.classList.add('is-loading');
    box.hidden = false;
    sync();
    const r = await load(body);
    if (id !== opened || box.hidden) return;
    box.classList.remove('is-loading');
    text.textContent = r.text;
    const voiced = r.audio && !r.fallback; // the template (an API failure) shows no audio controls
    kicker.textContent = r.fallback ? 'Standard summary, built from the numbers' : '';
    credit.textContent = [!r.fallback && 'Summary by Gemini', voiced && 'Voice by ElevenLabs'].filter(Boolean).join(' · ');
    if (voiced) {
      audio.src = `data:audio/mpeg;base64,${r.audio}`;
      if (voice) start();
    }
    sync();
  }
  function hide() {
    if (box.hidden) return;
    if (box.contains(document.activeElement)) reopen.focus(); // keyboard focus stays near, not lost to <body>
    opened++; box.hidden = true; stop();
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) { e.preventDefault(); hide(); } });
  // a click anywhere else closes it, and still does what it was for (no backdrop: the map and the tour stay usable)
  addEventListener('pointerdown', e => { if (!box.hidden && !box.contains(e.target) && !launcher.contains(e.target)) hide(); }, true);

  const popped = new Set(); // recaps that have popped up by itself this session
  function done(key, label, body) {
    recaps.set(key, { label, body });
    if (!pick.querySelector(`option[value="${key}"]`)) pick.append(h('option', { value: key }, label)); // decades end in order
    pick.value = key; reopen.textContent = label;
    pick.hidden = recaps.size < 2;
    launcher.hidden = false; place();
    if (!popped.has(key)) { popped.add(key); open(key); }
  }
  // A decade played out (not paused or seeked) to its last year.
  let wasPlaying = false;
  clock.subscribe(s => {
    const ended = wasPlaying && !s.playing && s.step >= s.steps && s.frac >= 1 && !s.error;
    wasPlaying = s.playing;
    const run = s.shown?.data?.run;
    if (ended && run) { const g = game.get(); done(String(g.turn + 1), `Decade ${g.turn + 1} recap`, recapBody(run, g.from, g.to, g.startYear)); }
    gameOver(s);
  });
  // The game ended (sim-plate.js "Game complete"): the whole game, once the clock shows its last year.
  function gameOver(s) {
    const g = game.get(), run = s.shown?.data?.run;
    if (g.over && !recaps.has('game') && run && !s.stale && s.shown.step === g.to)
      done('game', 'Game recap', recapBody(run, 0, g.to, g.startYear));
  }
  game.subscribe(() => gameOver(clock.get()));
  return { open, hide };
}
