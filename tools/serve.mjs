import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8123);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, '404.html'), (e2, page) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving', ROOT, 'on', PORT));
