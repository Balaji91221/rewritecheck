// Optional static preview host for the browser demo. No provider or API server.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const coreRoot = process.argv[2] && resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 4174);
if (!coreRoot || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Usage: node examples/promptforge-server.mjs /absolute/path/to/promptforge/core/dist [port]');
  process.exitCode = 2;
} else {
  await stat(resolve(coreRoot, 'prompt-helper/index.js'));
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let root, relative, type;
      if (pathname === '/') {
        root = resolve(projectRoot, 'examples'); relative = 'promptforge.html'; type = 'text/html';
      } else if (pathname === '/examples/promptforge-adapter.mjs') {
        root = resolve(projectRoot, 'examples'); relative = 'promptforge-adapter.mjs'; type = 'text/javascript';
      } else if (pathname.startsWith('/dist/') && pathname.endsWith('.js')) {
        root = resolve(projectRoot, 'dist'); relative = pathname.slice('/dist/'.length); type = 'text/javascript';
      } else if (pathname.startsWith('/promptforge/') && pathname.endsWith('.js')) {
        root = coreRoot; relative = pathname.slice('/promptforge/'.length); type = 'text/javascript';
      } else { res.writeHead(404).end(); return; }
      const path = resolve(root, relative);
      if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`PromptForge + RewriteCheck local demo: http://127.0.0.1:${port}`));
}
