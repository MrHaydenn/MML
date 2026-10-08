const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createClient } = require('../electron/modrinth.cjs');
const { createLibrary } = require('../electron/library.cjs');
const api = createClient();
const library = createLibrary(path.join(__dirname, '../.preview-data'));
const methods = { ...api, library: () => library.list(), createProfile: input => library.create(input), removeProfile: id => library.remove(id), openLibrary: () => { throw new Error('Open storage is available in the Windows desktop app.'); }, openProject: () => { throw new Error('External links are available in the Windows desktop app.'); } };
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:4173' && req.headers.host !== 'localhost:4173') { res.writeHead(403); return res.end(); }
    if (req.url.startsWith('/api/') && req.method === 'POST') {
      if (req.headers.origin && !['http://127.0.0.1:4173', 'http://localhost:4173'].includes(req.headers.origin)) { res.writeHead(403); return res.end(); }
      const method = req.url.slice(5);
      if (!Object.hasOwn(methods, method)) { res.writeHead(404); return res.end(); }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Request too large'); }
      const result = await methods[method](JSON.parse(body).value);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(result ?? null));
    }
    if (!files[req.url]) { res.writeHead(404); return res.end(); }
    const [file, type] = files[req.url];
    res.writeHead(200, { 'Content-Type': type }); res.end(await fs.readFile(path.join(__dirname, '../src', file)));
  } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
}).listen(4173, '127.0.0.1', () => console.log('MML preview: http://127.0.0.1:4173'));
