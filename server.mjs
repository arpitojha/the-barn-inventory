/**
 * Zero-dependency static server for local development.
 *
 * ES modules and service workers need a real http:// origin (opening
 * index.html with file:// will not work), so: `npm start`.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    }).end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
  }
});

server.listen(PORT, () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address);

  console.log('\n  The Barn — bar inventory\n');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const address of addresses) console.log(`  Network: http://${address}:${PORT}`);
  console.log('\n  Phones on the same Wi-Fi can open the Network address.');
  console.log('  Installing to a home screen needs https:// — see README.md.\n');
});
