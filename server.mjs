import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
http.createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(content);
  } catch { response.writeHead(404).end('Archivo no encontrado'); }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
