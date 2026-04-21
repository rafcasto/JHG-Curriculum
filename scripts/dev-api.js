/**
 * scripts/dev-api.js
 *
 * Lightweight local API server that runs the Vercel handler functions
 * so you can use `npm run dev` (Vite on :5173) + API routes on :3000
 * without needing `vercel link` or `vercel dev`.
 *
 *   Terminal 1:  node scripts/dev-api.js
 *   Terminal 2:  npm run dev
 */

import 'dotenv/config';
import { createServer } from 'http';

// Import the Vercel serverless handlers
import filesHandler from '../api/files.js';
import fileHandler from '../api/file.js';
import graphHandler from '../api/graph.js';
import usersHandler from '../api/users.js';
import foldersHandler from '../api/folders.js';

const PORT = 3000;

/** Build a minimal req/res shim that matches the Vercel handler signature */
function runHandler(handler, nodeReq, nodeRes) {
  // Parse query string
  const url = new URL(nodeReq.url, `http://localhost:${PORT}`);
  const query = Object.fromEntries(url.searchParams.entries());

  // Collect body for PUT/POST
  let body = '';
  nodeReq.on('data', (chunk) => { body += chunk; });
  nodeReq.on('end', () => {
    let parsedBody = {};
    try { parsedBody = body ? JSON.parse(body) : {}; } catch {}

    // Vercel-compatible req wrapper
    const req = {
      method: nodeReq.method,
      url: nodeReq.url,
      query,
      headers: nodeReq.headers,
      body: parsedBody,
    };

    // Vercel-compatible res wrapper
    let statusCode = 200;
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    const res = {
      status(code) { statusCode = code; return res; },
      setHeader(k, v) { headers[k] = v; return res; },
      json(data) {
        nodeRes.writeHead(statusCode, headers);
        nodeRes.end(JSON.stringify(data));
      },
    };

    handler(req, res).catch((err) => {
      console.error('[dev-api]', err.message);
      nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: err.message }));
    });
  });
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  if (pathname === '/api/files')   return runHandler(filesHandler,   req, res);
  if (pathname === '/api/file')    return runHandler(fileHandler,    req, res);
  if (pathname === '/api/graph')   return runHandler(graphHandler,   req, res);
  if (pathname === '/api/users')   return runHandler(usersHandler,   req, res);
  if (pathname === '/api/folders') return runHandler(foldersHandler, req, res);

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`API dev server running on http://localhost:${PORT}`);
  console.log('  GET         /api/files');
  console.log('  GET         /api/graph');
  console.log('  GET         /api/folders');
  console.log('  GET         /api/file?id=<id>');
  console.log('  POST        /api/file?folderId=<id>');
  console.log('  PUT         /api/file?id=<id>');
  console.log('  DELETE      /api/file?id=<id>');
  console.log('  GET         /api/users');
  console.log('  POST        /api/users');
  console.log('  PATCH       /api/users?uid=<uid>');
  console.log('  DELETE      /api/users?uid=<uid>');
});
