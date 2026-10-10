// The narration panel: POSTs the current SimResult to /api/narration, shows the recap and plays it. Plain DOM.
// mountNarration(container, getSimResult) renders straight away; call the returned refresh() when the result changes.

/** @param {HTMLElement} container @param {() => import('../../shared/types').SimResult | null} getSimResult */
export function mountNarration(container, getSimResult) {
  container.innerHTML = `
    <section class="narration">
      <p class="narration-label" style="margin:0;font-size:.75rem;opacity:.7">AI-generated summary of simulation results</p>
      <p class="narration-text" aria-live="polite"></p>
      <button type="button" class="narration-play" disabled>Play</button>
      <span class="narration-fallback" style="margin-left:.5rem;font-size:.75rem;opacity:.6" hidden
        title="The AI recap was unavailable, so this summary was built directly from the numbers.">Standard summary</span>
    </section>`;
  const text = container.querySelector('.narration-text');
  const play = container.querySelector('.narration-play');
  const fallback = container.querySelector('.narration-fallback');
  const audio = new Audio();
  play.onclick = () => (audio.paused ? audio.play() : audio.pause());
  audio.onplay = () => { play.textContent = 'Pause'; };
  audio.onpause = audio.onended = () => { play.textContent = 'Play'; };

  let latest = 0;
  async function refresh() {
    const id = ++latest;
    audio.pause();
    audio.removeAttribute('src');
    play.disabled = true;
    fallback.hidden = true;
    const r = getSimResult();
    if (!r?.policies?.length) { text.textContent = 'Add a policy to hear a recap.'; return; }
    text.textContent = 'Writing a recap…';
    try {
      const { policies, years, deltas, tradeoffs } = r; // just what the recap needs, not every year's zone map
      const res = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policies, years, deltas, tradeoffs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (id !== latest) return;
      text.textContent = data.text;
      fallback.hidden = !data.fallback;
      if (data.audio) {
        audio.src = `data:audio/mpeg;base64,${data.audio}`;
        play.disabled = false;
      }
    } catch (err) {
      if (id === latest) text.textContent = 'The recap is unavailable right now.';
      console.error('narration:', err);
    }
  }
  refresh();
  return { refresh };
}
