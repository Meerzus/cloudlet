import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

const directory = resolve('apps/lab/dist');
const nonce = randomBytes(18).toString('base64');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const policy = [
  "default-src 'none'",
  `script-src 'self' 'nonce-${nonce}'`,
  `style-src 'self' 'nonce-${nonce}'`,
  "style-src-attr 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const file = resolve(directory, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (file !== directory && !file.startsWith(`${directory}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const extension = extname(file);
    let body = await readFile(file);
    if (extension === '.html') body = Buffer.from(body.toString().replace('<head>', `<head><meta name="csp-nonce" content="${nonce}">`));
    response.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Content-Security-Policy': policy,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500).end();
  }
}).listen(4173, '127.0.0.1', () => process.stdout.write('Cloudlet production CSP fixture: http://127.0.0.1:4173\n'));
