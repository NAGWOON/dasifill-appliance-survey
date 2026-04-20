/**
 * Cloudflare Worker — 가전 설문 전용 Telegram 프록시
 *
 * Cloudflare 대시보드 → Worker → Settings → Variables 에서 시크릿 설정:
 *   TELEGRAM_BOT_TOKEN   ← 봇 토큰 (8637144...)
 *   TELEGRAM_CHAT_ID     ← 채널 ID (-5131...)
 *   QUEST_API_KEY        ← appliance-quest.html 의 telegramProxyKey 값과 동일
 *
 * 배포:
 *   cd workers
 *   npx wrangler deploy
 *
 * 엔드포인트:
 *   POST {WORKER_URL}/send   body: { apiKey, cardHtml, csvContent, csvFilename, caption }
 *   POST {WORKER_URL}/test   body: { apiKey }  — 연결 테스트용
 */

const TG = 'https://api.telegram.org';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

async function sendMessage(token, chatId, text, parseMode) {
  const payload = { chat_id: chatId, text };
  if (parseMode) payload.parse_mode = parseMode;
  const res = await fetch(`${TG}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `sendMessage ${res.status}`);
  return data;
}

async function sendDocument(token, chatId, content, filename, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([content], { type: 'text/csv' }), filename || 'survey.csv');
  if (caption) form.append('caption', caption);
  const res = await fetch(`${TG}/bot${token}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `sendDocument ${res.status}`);
  return data;
}

function authorize(body, env) {
  return !!(env.QUEST_API_KEY && body && body.apiKey === env.QUEST_API_KEY);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders();

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400, cors);
    }

    if (!authorize(body, env)) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401, cors);
    }

    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return jsonResponse({ ok: false, error: 'worker_env_missing' }, 500, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    try {
      if (path.endsWith('/test')) {
        await sendMessage(token, chatId, '✅ DASIFILL 가전 설문 프록시 연결 테스트', null);
        return jsonResponse({ ok: true }, 200, cors);
      }

      if (path.endsWith('/send')) {
        const { cardHtml, csvContent, csvFilename, caption } = body;
        if (!cardHtml || csvContent === undefined) {
          return jsonResponse({ ok: false, error: 'missing_fields' }, 400, cors);
        }
        await sendMessage(token, chatId, cardHtml, 'HTML');
        await sendDocument(token, chatId, csvContent, csvFilename || 'survey.csv', caption || '');
        return jsonResponse({ ok: true }, 200, cors);
      }

      return jsonResponse({ ok: false, error: 'not_found' }, 404, cors);

    } catch (e) {
      return jsonResponse({ ok: false, error: String(e && e.message ? e.message : e) }, 502, cors);
    }
  }
};
