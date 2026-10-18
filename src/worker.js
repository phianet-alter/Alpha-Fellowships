/* Alpha Fellowship: Cloudflare Worker
   - Serves the static site from ./public (free, unlimited)
   - POST /api/ai  -> private proxy to Google Gemini. The API key lives in the
     Cloudflare secret GEMINI_KEY, so it is never in your code or in the browser. */

const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const MAX_BODY_BYTES = 120_000;
const TIMEOUT_MS = 25_000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function routes(model, key) {
  return [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': key },
    },
    {
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      headers: {},
    },
  ];
}

async function handleAI(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Only your own site may call this endpoint (blocks other websites using your key).
  const origin = request.headers.get('Origin');
  if (!origin || new URL(origin).host !== url.host) return json({ error: 'Forbidden' }, 403);

  if (!env.GEMINI_KEY) return json({ error: 'AI is not configured yet' }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request too large' }, 413);

  let system, contents;
  try {
    ({ system, contents } = JSON.parse(raw));
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  if (typeof system !== 'string' || system.length > 10_000) return json({ error: 'Bad system prompt' }, 400);
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > 40) return json({ error: 'Bad contents' }, 400);

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
  });

  let lastStatus = 502;
  for (const model of MODELS) {
    for (const r of routes(model, env.GEMINI_KEY)) {
      try {
        const res = await fetch(r.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...r.headers },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) {
          const j = await res.json();
          const parts = j?.candidates?.[0]?.content?.parts ?? [];
          const text = parts.map((p) => p.text || '').join('').trim();
          if (text) return json({ text });
        } else {
          lastStatus = res.status;
        }
      } catch {
        /* try the next model/route */
      }
    }
  }
  return json({ error: 'AI is unavailable right now' }, lastStatus === 429 ? 429 : 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai') return handleAI(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
