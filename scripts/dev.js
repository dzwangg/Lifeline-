// Local server: the repo's static files, and POST /api/<name> to api/<name>.js, as Vercel serves them. Reads keys from .env.local.
// Usage: npm run dev [-- port]   then open http://localhost:3000/meridian-city/resident/demo.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile('.env.local'); } catch {}
const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = +process.argv[2] || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (api) {
      const mod = await import(`../api/${api[1]}.js`).catch(() => null);
      if (!mod?.[req.method]) return res.writeHead(mod ? 405 : 404).end();
      const handler = mod[req.method];
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handler(new Request(url, { method: req.method, headers: { 'content-type': req.headers['content-type'] ?? '', 'x-forwarded-for': '127.0.0.1' }, body: Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const path = normalize(join(root, decodeURIComponent(url.pathname)));
    // never serve dotfiles (.env.local) or anything outside the repo
    if (!path.startsWith(root) || path.slice(root.length).split(sep).some(p => p.startsWith('.'))) return res.writeHead(404).end();
    const file = path.endsWith(sep) ? join(path, 'index.html') : path;
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(content);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EISDIR') console.error(err);
    res.writeHead(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500).end();
  }
}).listen(port, () => console.log(`http://localhost:${port}/meridian-city/resident/demo.html`));
