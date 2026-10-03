const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/estilos.css': ['estilos.css', 'text/css; charset=utf-8'],
  '/productos.csv': ['productos.csv', 'text/csv; charset=utf-8'],
};
const server = http.createServer(async (req, res) => {
  const file = files[req.url.split('?')[0]];
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
  }
  if (!file) { res.writeHead(404); return res.end('No encontrado'); }
  try {
    const content = await readFile(join(__dirname, 'public', file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(500); res.end('No se pudo cargar la demo.');
  }
});
const port = Number(process.env.PORT || 3001);
server.listen(port, '127.0.0.1', () => console.log(`Demo original: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
