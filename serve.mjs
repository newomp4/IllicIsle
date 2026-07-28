/* A dev server that refuses to let the browser cache anything.
   ES modules are cached per URL, so a half-updated module graph shows up as
   an eternal loading bar rather than an error. python3 -m http.server sends
   Last-Modified and lets the browser decide; this does not. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.argv[2] || 8000);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.md': 'text/markdown', '.txt': 'text/plain',
};

http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    s.writeHead(404, { 'Content-Type': 'text/plain' });
    s.end('404');
    return;
  }
  s.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  fs.createReadStream(file).pipe(s);
}).listen(PORT, () => console.log(`Illic Isle on http://localhost:${PORT}/`));
