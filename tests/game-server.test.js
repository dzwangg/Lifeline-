import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleRequest } from '../scripts/game-server.js';

test('root redirects so relative game assets resolve under meridian-city', async () => {
  const server = createServer((req, res) => handleRequest(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const redirect = await fetch(origin, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/meridian-city/index.html');
    for (const asset of ['/meridian-city/index.html', '/meridian-city/chapel-hill.js', '/meridian-city/policy/policy-panel.css']) {
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200, asset);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
