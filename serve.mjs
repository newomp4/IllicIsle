/* A dev server that refuses to let the browser cache anything.
   ES modules are cached per URL, so a half-updated module graph shows up as
   an eternal loading bar rather than an error. python3 -m http.server sends
   Last-Modified and lets the browser decide; this does not. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* A URL's pathname is percent-encoded, so a checkout under a directory with a
   space in it gave a ROOT containing a literal '%20' — a path no file lives
   under, and every request 404'd against a server that looked healthy. */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8000);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.md': 'text/markdown', '.txt': 'text/plain',
};

http.createServer((q, s) => {
  /* A stray percent in the URL used to take the whole server down: an
     unpaired escape makes decodeURIComponent throw, nothing caught it, and
     node exits on an uncaught exception in a request handler. One bad link
     and the next reload says the site is not running at all. */
  let p;
  try { p = decodeURIComponent(q.url.split('?')[0]); }
  catch { p = null; }
  if (p === '/') p = '/index.html';
  const file = p === null ? null : path.join(ROOT, p);
  /* ROOT without the separator matches a SIBLING whose name merely starts
     with it — path.join('…/IllicIsle', '/../IllicIsle-private/x') lands on
     '…/IllicIsle-private/x', which passes startsWith(ROOT) and is served. */
  if (!file || !file.startsWith(ROOT + path.sep)
      || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    s.writeHead(404, { 'Content-Type': 'text/plain' });
    s.end('404');
    return;
  }
  const rs = fs.createReadStream(file);
  /* pipe() guards the destination, not the source, so an open that fails
     after the statSync above — an editor's atomic save is write-temp-then-
     rename, and the file is briefly gone — exits node the same way the
     decodeURIComponent throw used to. Hold the 200 back until the fd is
     open so a failure can still answer with a real status. */
  rs.on('error', () => {
    if (!s.headersSent) { s.writeHead(404, { 'Content-Type': 'text/plain' }); s.end('404'); }
    else s.destroy();
  });
  rs.on('open', () => {
    s.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    rs.pipe(s);
  });
}).listen(PORT, () => console.log(`Illic Isle on http://localhost:${PORT}/`));
