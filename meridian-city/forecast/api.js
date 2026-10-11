// Talks to the forecast API (backend/chsim/api/app.py). Falls back to the precomputed demo scenarios in
// data/forecast/demo/ when no server answers (e.g. the static GitHub Pages site); those are labelled as demos.
// ?api=http://host:port points the page at a server on another origin.

const query = new URLSearchParams(location.search);
const API = (query.get('api') ?? '').replace(/\/$/, '');
const site = path => new URL(`../../data/forecast/${path}`, import.meta.url);
const getJSON = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status, body: await r.json().catch(() => null) });
  return r.json();
};

let mode = null; // 'live' | 'static'
export async function connect() {
  if (mode) return mode;
  try {
    await getJSON(`${API}/api/health`, { signal: AbortSignal.timeout(2500) });
    mode = 'live';
  } catch { mode = 'static'; }
  return mode;
}
export const isLive = () => mode === 'live';

export async function catalog() {
  return getJSON(site('catalog.json')); // same content as /api/catalog/*, available with or without a server
}
export const demoIndex = () => getJSON(site('demo/index.json'));
export const demo = id => getJSON(site(`demo/${id}.json`));

export async function validate(scenario) {
  if (!isLive()) return { valid: true, errors: [], warnings: [] };
  return getJSON(`${API}/api/scenarios/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scenario) });
}

/** Submits one job and polls it to completion. onProgress(fraction, message). Resolves to the result payload. */
export async function runJob(scenario, onProgress = () => {}) {
  const job = await getJSON(`${API}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
  onProgress(job.cached ? 1 : 0.02, job.cached ? 'from cache' : 'queued');
  let j = job;
  while (j.status !== 'done') {
    if (j.status === 'error') throw new Error(j.message || 'forecast failed');
    await new Promise(r => setTimeout(r, 200));
    j = await getJSON(`${API}/api/jobs/${job.job_id}`);
    onProgress(j.progress ?? 0, j.message ?? j.status);
  }
  return getJSON(`${API}/api/results/${job.result_key}`);
}

export async function explanation(resultKey) {
  if (!isLive() || !resultKey) return null;
  return getJSON(`${API}/api/results/${resultKey}/explanation`);
}
