/**
 * A tiny static server for the site's export (apps/site/out), shared by the recording
 * and checking scripts: `const server = await serve(); server.address().port`. Text is gzipped
 * when the client accepts it, as any static host does (Lighthouse measures transfer sizes).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../out', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
};

export function serve() {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const candidates = [join(ROOT, path), join(ROOT, `${path}.html`), join(ROOT, path, 'index.html')];
    const file = candidates.find((candidate) => candidate.startsWith(ROOT) && existsSync(candidate) && statSync(candidate).isFile());
    if (!file) {
      response.writeHead(404).end('not found');
      return;
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const gzip = !/^(image|font)\//u.test(type) && /\bgzip\b/u.test(request.headers['accept-encoding'] ?? '');
    response.writeHead(200, { 'content-type': type, vary: 'accept-encoding', ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
    const stream = createReadStream(file);
    if (gzip) stream.pipe(createGzip()).pipe(response);
    else stream.pipe(response);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}
