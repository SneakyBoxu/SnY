import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('./dist', import.meta.url));
const port = Number(process.env.PORT || 8081);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Proxy Open Food Facts to bypass web browser CORS restrictions
  if (req.url?.startsWith('/api/off/search')) {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost:8081'}`);
    const q = u.searchParams.get('q') || '';
    const pageSize = u.searchParams.get('pageSize') || '20';
    const v2Url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(
      q,
    )}&page_size=${pageSize}&fields=code,product_name,product_name_en,generic_name,brands,nutriments,categories,image_front_small_url,serving_size`;

    const headers = {
      'User-Agent': 'CalInCalOut/1.0.0 (https://github.com/calincalout; contact@calincalout.app)',
    };

    fetch(v2Url, { headers })
      .then(async (upstreamRes) => {
        if (!upstreamRes.ok) {
          // Fallback to legacy CGI search
          const cgiUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
            q,
          )}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=code,product_name,product_name_en,generic_name,brands,nutriments,categories,image_front_small_url,serving_size`;
          const fallbackRes = await fetch(cgiUrl, { headers });
          const text = await fallbackRes.text();
          res.writeHead(fallbackRes.ok ? 200 : 200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(fallbackRes.ok ? text : JSON.stringify({ count: 0, products: [] }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        const data = await upstreamRes.text();
        res.end(data);
      })
      .catch(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ count: 0, products: [] }));
      });
    return;
  }

  if (req.url?.startsWith('/api/gemini/vision')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-gemini-key',
      });
      res.end();
      return;
    }

    let bodyData = '';
    req.on('data', (chunk) => {
      bodyData += chunk;
    });
    req.on('end', async () => {
      try {
        const apiKey =
          req.headers['x-gemini-key'] ||
          process.env.GEMINI_API_KEY ||
          '';

        // Free-tier high-throughput models (primary is gemini-3.5-flash which is responsive and not rate-limited)
        const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
        let lastRespText = '';
        let lastStatus = 500;

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        modelLoop: for (const model of models) {
          const delays = [0, 1000];

          for (let attempt = 0; attempt < delays.length; attempt++) {
            if (delays[attempt] > 0) {
              await sleep(delays[attempt]);
            }

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
              apiKey,
            )}`;

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 25000);

            try {
              const upstream = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bodyData,
                signal: controller.signal,
              });
              clearTimeout(timer);

              lastStatus = upstream.status;
              lastRespText = await upstream.text();

              if (upstream.status === 200) {
                break modelLoop;
              }

              // On 429/404/503 switch immediately to next model
              break;
            } catch (e) {
              clearTimeout(timer);
              lastStatus = 504;
              lastRespText = JSON.stringify({ error: String(e) });
              break;
            }
          }
        }

        res.writeHead(lastStatus, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(lastRespText);
      } catch (err) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.url?.startsWith('/api/off/product')) {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost:8081'}`);
    const barcode = u.searchParams.get('barcode') || '';
    const targetUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;

    fetch(targetUrl, {
      headers: {
        'User-Agent': 'CalInCalOut/1.0.0 (https://github.com/calincalout; contact@calincalout.app)',
      },
    })
      .then(async (upstreamRes) => {
        res.writeHead(upstreamRes.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        const data = await upstreamRes.text();
        res.end(data);
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(err) }));
      });
    return;
  }

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/favicon.ico') {
    const icoPath = join(distDir, 'favicon.ico');
    if (existsSync(icoPath)) {
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      createReadStream(icoPath).pipe(res);
    } else {
      res.writeHead(204);
      res.end();
    }
    return;
  }

  if (urlPath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let filePath = join(distDir, urlPath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const cleanUrlFile = join(distDir, `${urlPath.replace(/\/+$/, '')}.html`);
    if (urlPath !== '/' && existsSync(cleanUrlFile)) {
      filePath = cleanUrlFile;
    } else {
      filePath = join(distDir, 'index.html');
    }
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Cal In Cal Out (web) -> http://localhost:${port}`);
});
