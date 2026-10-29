import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { spawn } from 'node:child_process';
const report = JSON.parse(await readFile('artifacts/integration/consumers.json', 'utf8'));
const servers = [], children = [];
for (const item of report.consumers) {
  if (item.name === 'next') {
    const child = spawn(process.execPath, [resolve(item.path, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(item.port)], { cwd: item.path, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit' });
    children.push(child); continue;
  }
  if (item.name === 'vite19' || item.name === 'vite18') {
    const env = { ...process.env, NODE_ENV: 'development' };
    delete env.NODE_PATH;
    const child = spawn(process.execPath, [resolve(item.path, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', item.name === 'vite19' ? '4283' : '4284', '--strictPort'], { cwd: item.path, env, stdio: 'inherit' });
    children.push(child);
  }
  const directory = resolve(item.path, 'dist');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const file = resolve(directory, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
      const extension = extname(file), nonce = randomBytes(18).toString('base64');
      let body = await readFile(file);
      if (extension === '.html') body = Buffer.from(body.toString().replace('<head>', `<head><meta name="csp-nonce" content="${nonce}">`));
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' })[extension] ?? 'application/octet-stream', 'Content-Security-Policy': ["default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, `style-src 'self' 'nonce-${nonce}'`, "style-src-attr 'none'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"].join('; '), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  server.listen(item.port, '127.0.0.1'); servers.push(server);
}
function stop() { for (const child of children) child.kill(); for (const server of servers) server.close(); }
process.on('SIGTERM', () => { stop(); process.exit(); });
process.on('SIGINT', () => { stop(); process.exit(); });
