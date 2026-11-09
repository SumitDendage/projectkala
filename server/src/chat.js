/* The AI travel consultant at POST /api/chat: asks Claude (Anthropic API) and streams the answer
   back in the format the page reads (lines of `data: {"type":"text-delta","delta":"…"}`).
   Needs ANTHROPIC_API_KEY. Optional: CHAT_MODEL (default claude-opus-5-5), CHAT_EFFORT (default low). */
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const sec = require('./security');
const { clientIp } = require('./visitor');

const MODEL = process.env.CHAT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CHAT_EFFORT || 'low'; // chat answers don't need deep reasoning; keeps replies quick
// Server-side fallback re-runs a request that a model's safety filters decline on another Claude model.
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];

// Places featured on the site, so Claude can connect answers to them.
const PLACES = [
  'Jaisalmer (Rajasthan, best Oct–Mar)', 'Manali (Himachal Pradesh, best Apr–Jun and Sep–Nov)',
  'Alleppey (Kerala, best Oct–Mar)', 'Munnar (Kerala, best Sep–Mar)', 'Tawang (Arunachal Pradesh, best Mar–Jun and Sep–Oct)',
  'Dehradun (Uttarakhand, best Oct–Apr)', 'Spiti Valley (Himachal Pradesh, best Jun–Oct)',
  'Sohra and the living root bridges (Meghalaya, best Oct–Apr)', 'Robber’s Cave (Dehradun, Uttarakhand, best Mar–Jun)'
];
const SYSTEM = [
  'You are the AI travel consultant on "India’s Hidden Gems", a website about lesser-known places in India.',
  'Help visitors plan trips to quieter places in India only; if asked about somewhere else, say you focus on India and suggest a similar Indian place.',
  'Be warm, specific and practical. Suggest one to three places, and for each say why it is special, the best months, how to get there,',
  'any permits needed (for example Inner Line Permits in parts of the North East), and a rough daily budget in Indian rupees.',
  'Write in Markdown with short paragraphs or lists, under 250 words unless the visitor asks for more.',
  'If you are not sure about road conditions, permits, prices or opening times, say so and suggest checking locally before travelling.',
  `Places featured on the site: ${PLACES.join('; ')}.`,
  // The site turns this block into photo cards and a map under the answer; visitors never see the JSON.
  'When your answer suggests specific places, end it with one fenced code block whose language is "places", holding a JSON array',
  'of up to three objects in the order you described them: {"name": "Ziro", "state": "Arunachal Pradesh", "lat": 27.54, "lon": 93.83, "wiki": "Ziro"}.',
  'Use the decimal coordinates of the place itself and its exact English Wikipedia article title as "wiki" (null if there is none).',
  'Write nothing after the block and never mention it.'
].join(' ');

let client = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
};

// The page sends the whole conversation each time (AI SDK UI-message shape). Keep the recent part.
function toMessages(body) {
  const msgs = (Array.isArray(body && body.messages) ? body.messages : [])
    .map(m => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: (Array.isArray(m && m.parts) ? m.parts : [])
        .filter(p => p && p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text).join('\n').trim().slice(0, 6000)
    }))
    .filter(m => m.content)
    .slice(-20);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// Chat costs money per question: limit each visitor (by IP) to a steady pace.
const recent = new Map();
async function overLimit(req) {
  const ip = clientIp(req);
  if (db.configured()) {
    try { return await sec.limited([['chat-ip', ip, 40, 60]]); } catch (e) { /* fall back to memory */ }
  }
  const now = Date.now(), hits = (recent.get(ip) || []).filter(t => now - t < 3600e3);
  hits.push(now); recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 40;
}

const router = express.Router();

router.post('/api/chat', express.json({ limit: '256kb' }), async (req, res) => {
  const anthropic = getClient();
  if (!anthropic) return res.status(503).json({ error: 'chat_not_configured' });
  const messages = toMessages(req.body);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'empty_message' });
  if (await overLimit(req)) return res.status(429).json({ error: 'too_many' });

  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const params = {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages,
    cache_control: { type: 'ephemeral' } // reuses the conversation so far on follow-up questions
  };
  if (EFFORT) params.output_config = { effort: EFFORT };
  if (FALLBACK_MODELS.includes(MODEL)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

  const stream = anthropic.beta.messages.stream(params);
  let closed = false;
  res.on('close', () => { closed = true; stream.abort(); }); // visitor pressed Stop or left
  stream.on('text', delta => { if (!closed) send({ type: 'text-delta', id: 'answer', delta }); });
  try {
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      send({ type: 'text-delta', id: 'answer', delta: '\n\nI can’t help with that request. Ask me about a place or a trip in India instead.' });
    } else if (final.stop_reason === 'max_tokens') {
      send({ type: 'text-delta', id: 'answer', delta: '\n\n(The answer was cut short. Ask a follow-up to continue.)' });
    }
    send({ type: 'finish' });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (closed || err instanceof Anthropic.APIUserAbortError) return res.end();
    if (err instanceof Anthropic.AuthenticationError) console.error('AI chat: ANTHROPIC_API_KEY was refused');
    else if (err instanceof Anthropic.RateLimitError) console.error('AI chat: Anthropic rate limit reached');
    else if (err instanceof Anthropic.APIError) console.error(`AI chat: Anthropic error ${err.status}: ${err.message}`);
    else console.error('AI chat failed:', err.message);
    send({ type: 'error', errorText: 'The consultant is unavailable right now.' });
    res.end();
  }
});

module.exports = router;
module.exports.configured = () => !!process.env.ANTHROPIC_API_KEY;
