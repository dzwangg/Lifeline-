// Serve the game and handle player policy proposals without exposing GEMINI_API_KEY to browsers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCard } from './create-policy-card.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = new URL('../data/', import.meta.url);
const zones = JSON.parse(await readFile(new URL('zones.geojson', data), 'utf8')).features.map(f => f.properties);
const assumptions = JSON.parse(await readFile(new URL('assumptions.json', data), 'utf8'));
const baselines = JSON.parse(await readFile(new URL('baselines.json', data), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const sendJson = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10000) throw new Error('Request is too long.');
  }
  try { return JSON.parse(body); } catch { throw new Error('Request must be JSON.'); }
}

export async function handleRequest(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/policies/generate') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to propose a policy.' });
    if (!process.env.GEMINI_API_KEY) return sendJson(res, 503, { error: 'Policy drafting is unavailable: the server has no GEMINI_API_KEY.' });
    try {
      const { idea } = await bodyJson(req);
      if (typeof idea !== 'string' || !idea.trim() || idea.length > 1200)
        return sendJson(res, 400, { error: 'Describe a policy in 1 to 1200 characters.' });
      const card = await generateCard(idea, { apiKey: process.env.GEMINI_API_KEY, zones, assumptions, baselines });
      return sendJson(res, 200, { card });
    } catch (error) {
      const message = error.message ?? 'Could not draft the policy.';
      return sendJson(res, /^(Request|This idea|Gemini generated)/.test(message) ? 422 : 502, { error: message });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (pathname === '/' || pathname === '/meridian-city/') {
    res.writeHead(302, { Location: '/meridian-city/index.html' });
    return res.end();
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendJson(res, 400, { error: 'Invalid path.' }); }
  const requested = decoded;
  if (!/^\/(meridian-city|data|shared)\/|^\/tests\/fixtures\//.test(requested))
    return sendJson(res, 404, { error: 'File not found.' });
  const file = resolve(root, `.${requested}`);
  const within = relative(root, file);
  if (within.startsWith('..' + sep) || within === '..' || resolve(root) === file)
    return sendJson(res, 403, { error: 'Forbidden.' });
  try {
    const contents = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${types[extname(file)] ?? 'application/octet-stream'}${['.js', '.css', '.html', '.json', '.geojson'].includes(extname(file)) ? '; charset=utf-8' : ''}` });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch {
    sendJson(res, 404, { error: 'File not found.' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createServer((req, res) => { handleRequest(req, res).catch(() => sendJson(res, 500, { error: 'Server error.' })); })
    .listen(port, host, () => console.log(`Game ready at http://${host}:${port}/`));
}
