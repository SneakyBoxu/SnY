const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// -------------------------------------------------------------
// Dev-only /api proxy (mirrors serve-web.mjs so web dev server
// can reach Open Food Facts + Gemini without CORS issues)
// -------------------------------------------------------------

const OFF_FIELDS =
  'code,product_name,product_name_en,generic_name,brands,nutriments,categories,image_front_small_url,serving_size';

const OFF_HEADERS = {
  'User-Agent': 'CalInCalOut/1.0.0 (https://github.com/calincalout; contact@calincalout.app)',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}

async function handleOffSearch(res, params) {
  const q = params.get('q') || '';
  const pageSize = params.get('pageSize') || '20';
  const v2Url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(
    q,
  )}&page_size=${pageSize}&fields=${OFF_FIELDS}`;
  try {
    const upstream = await fetch(v2Url, { headers: OFF_HEADERS });
    if (upstream.ok) {
      sendJson(res, 200, await upstream.text());
      return;
    }
    const cgiUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      q,
    )}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=${OFF_FIELDS}`;
    const fallback = await fetch(cgiUrl, { headers: OFF_HEADERS });
    sendJson(res, 200, fallback.ok ? await fallback.text() : { count: 0, products: [] });
  } catch {
    sendJson(res, 200, { count: 0, products: [] });
  }
}

async function handleOffProduct(res, params) {
  const barcode = params.get('barcode') || '';
  try {
    const upstream = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { headers: OFF_HEADERS },
    );
    sendJson(res, upstream.status, await upstream.text());
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
}

async function handleGeminiVision(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-gemini-key',
    });
    res.end();
    return;
  }

  const bodyData = await readBody(req);
  const apiKey =
    req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY || '';

  const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
  let lastStatus = 500;
  let lastRespText = JSON.stringify({ error: 'No API key' });

  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyData },
        );
        lastStatus = upstream.status;
        lastRespText = await upstream.text();
        if (upstream.status === 200) break outer;
        break;
      } catch (e) {
        lastStatus = 504;
        lastRespText = JSON.stringify({ error: String(e) });
        break;
      }
    }
  }

  sendJson(res, lastStatus, lastRespText);
}

async function handleApi(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  if (req.url.startsWith('/api/off/search')) return handleOffSearch(res, u.searchParams);
  if (req.url.startsWith('/api/off/product')) return handleOffProduct(res, u.searchParams);
  if (req.url.startsWith('/api/gemini/vision')) return handleGeminiVision(req, res);
  sendJson(res, 404, { error: 'Not found' });
}

config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (req.url?.startsWith('/api/')) {
      handleApi(req, res).catch(() => {
        if (!res.writableEnded) sendJson(res, 500, { error: 'Proxy failed' });
      });
      return;
    }

    middleware(req, res, next);
  };
};

module.exports = config;
