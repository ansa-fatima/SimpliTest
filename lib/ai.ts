// AI test-case generation -- the only file that talks to a model provider, so
// swapping provider/model touches nothing else. Server-side only: the API key
// never reaches the browser. Four providers are supported (see lib/aiConfig.ts):
// Claude (Messages API, forced tool call), Gemini (generateContent), and everything
// that speaks the OpenAI chat-completions API (OpenAI, OpenRouter, Groq, Grok, Mistral,
// DeepSeek, Ollama, custom servers) -- all but Claude return JSON
// that matches the same schema. Everything above the "Provider calls" section works
// on one neutral request and does not care which one answers.

import { CaseStreamParser } from '@/lib/aiStream';
import type { AiConfig, AiProvider } from '@/lib/aiConfig';

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** One workspace option as the model sees it (display name only -- keys stay server-side). */
export interface OptionNames {
  priority: string[];
  severity: string[];
  type: string[];
}

export type Depth = 'happy' | 'edge' | 'negative';
export type StepStyle = 'actions' | 'gwt';

/** A test case exactly as the model returns it, before validation. */
export interface RawGeneratedCase {
  title?: unknown;
  desc?: unknown;
  preconditions?: unknown;
  steps?: unknown;
  expected?: unknown;
  priority?: unknown;
  severity?: unknown;
  type?: unknown;
  labels?: unknown;
}

/** A validated case, with priority/severity/type as option NAMES. */
export interface GeneratedCase {
  title: string;
  desc: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  labels: string[];
}

/** A PDF or image the user attached as (part of) the requirement. */
export interface AiAttachment {
  name: string;
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
}

export const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;
export const MAX_ATTACHMENTS = 4;
/** Decoded size cap per file. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface GenerateRequest {
  requirement: string;
  /** "LMS › Admin › Login" -- gives the model context about where the cases will live. */
  parentPath: string;
  count: number;
  depth: Depth;
  style: StepStyle;
  options: OptionNames;
  /** Titles already kept / already in the suite, so the model doesn't repeat them. */
  avoidTitles?: string[];
  attachments?: AiAttachment[];
}

const DEPTH_TEXT: Record<Depth, string> = {
  happy: 'Cover the main success path of each behaviour in the requirement.',
  edge: 'Cover the main success paths AND boundary / edge conditions (limits, empty values, repeated actions).',
  negative:
    'Cover success paths, edge conditions AND negative cases (invalid input, missing permission, failure handling).',
};

const STYLE_TEXT: Record<StepStyle, string> = {
  actions: 'Write each step as one short imperative action, e.g. "Open the Login page".',
  gwt: 'Write steps in Given / When / Then order, one short line each, prefixed with Given, When or Then.',
};

function systemPrompt(req: GenerateRequest): string {
  return [
    'You are a senior QA engineer writing manual test cases for a test management tool.',
    'Return the cases ONLY by calling the return_cases tool. Never answer in prose.',
    '',
    'Rules for every case:',
    '- title: specific, under 90 characters, starts with a verb ("Verify ...", "Check ..."), unique within the list.',
    '- desc: one or two sentences saying what is being verified and why.',
    '- preconditions: what must be true before step 1 (account, data, state). Empty string if none.',
    '- steps: 3 to 8 short steps a tester can follow without guessing. ' + STYLE_TEXT[req.style],
    '- expected: one short sentence describing the observable result.',
    `- priority must be exactly one of: ${req.options.priority.join(', ')}.`,
    `- severity must be exactly one of: ${req.options.severity.join(', ')}.`,
    `- type must be exactly one of: ${req.options.type.join(', ')}.`,
    '- labels: 0 to 3 short lowercase slugs such as "login" or "regression".',
    '- Do not include real personal data, passwords or secrets; use placeholders.',
    '- Base every case on the requirement. If something is not stated, do not invent product behaviour.',
    '',
    DEPTH_TEXT[req.depth],
  ].join('\n');
}

function userPrompt(req: GenerateRequest): string {
  const lines = [
    `Location in the product: ${req.parentPath || '(not specified)'}`,
    `Write exactly ${req.count} test cases for this requirement:`,
    '',
    '"""',
    req.requirement.trim(),
    '"""',
  ];
  const avoid = (req.avoidTitles ?? []).filter(Boolean).slice(0, 60);
  if (avoid.length > 0) {
    lines.push(
      '',
      'These cases already exist -- do NOT repeat or reword them, write different scenarios:',
      ...avoid.map(t => `- ${t}`),
    );
  }
  return lines.join('\n');
}

// Attached files first, then the written prompt -- the model reads them as part
// of the requirement.
function userContent(req: GenerateRequest): string | unknown[] {
  const text = userPrompt(req);
  const files = req.attachments ?? [];
  if (files.length === 0) return text;
  const blocks: unknown[] = files.map(f =>
    f.mediaType === 'application/pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: f.data },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: f.mediaType, data: f.data },
        },
  );
  blocks.push({
    type: 'text',
    text:
      `The attached file${files.length > 1 ? 's' : ''} (${files.map(f => f.name).join(', ')}) ` +
      'describe the requirement together with the text below.\n\n' +
      text,
  });
  return blocks;
}

function toolSchema(req: GenerateRequest) {
  return {
    type: 'object',
    properties: {
      cases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            desc: { type: 'string' },
            preconditions: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
            expected: { type: 'string' },
            priority: { type: 'string', enum: req.options.priority },
            severity: { type: 'string', enum: req.options.severity },
            type: { type: 'string', enum: req.options.type },
            labels: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'steps', 'expected', 'priority', 'severity', 'type'],
        },
      },
    },
    required: ['cases'],
  };
}

interface ToolCallOpts {
  cfg: AiConfig;
  model: string;
  system: string;
  /** Plain text, or content blocks (text + images/documents). */
  user: string | unknown[];
  toolName: string;
  description: string;
  schema: object;
  maxTokens: number;
}

/**
 * Sends one forced tool call to the model and returns the raw HTTP response
 * (JSON, or an event stream when `stream` is set). All provider details --
 * key, URL, error mapping -- live here.
 */
async function openMessages(
  opts: ToolCallOpts,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = opts.cfg.apiKey;
  if (!apiKey) {
    throw new AiError(
      'AI generation is not set up -- add an API key under Settings > Integrations.',
      503,
    );
  }
  const base = opts.cfg.baseUrl;

  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      cache: 'no-store',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        tools: [{ name: opts.toolName, description: opts.description, input_schema: opts.schema }],
        tool_choice: { type: 'tool', name: opts.toolName },
        ...(stream ? { stream: true } : {}),
      }),
    });
  } catch {
    throw new AiError('Could not reach the AI service. Try again in a moment.', 502);
  }

  if (res.status === 401 || res.status === 403)
    throw new AiError('The AI service rejected the API key configured on the server.', 502);
  if (res.status === 429)
    throw new AiError('The AI service is busy (rate limited). Try again in a moment.', 429);
  if (!res.ok) throw new AiError(`The AI service returned an error (${res.status}).`, 502);
  return res;
}

// ─── Provider calls ────────────────────────────────────────────────────────

// Gemini has no forced tool call whose arguments stream, so it is asked for JSON
// that matches the same schema instead (responseSchema). The text it streams is
// the very same document a Claude tool call would carry, so the callers can't tell
// the difference.

type GeminiSchema = Record<string, unknown>;

/** JSON-schema -> Gemini's OpenAPI-style schema (upper-case types, nullable flag). */
function toGeminiSchema(s: unknown): GeminiSchema {
  const src = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const out: GeminiSchema = {};
  let type = src.type;
  if (Array.isArray(type)) {
    const real = type.filter(t => t !== 'null');
    if (real.length < type.length) out.nullable = true;
    type = real[0];
  }
  if (typeof type === 'string') out.type = type.toUpperCase();
  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (src.properties && typeof src.properties === 'object')
    out.properties = Object.fromEntries(
      Object.entries(src.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  if (src.items) out.items = toGeminiSchema(src.items);
  if (Array.isArray(src.required)) out.required = src.required;
  return out;
}

/** The neutral content (text, or Claude-style blocks) as Gemini "parts". */
function geminiParts(user: string | unknown[]): unknown[] {
  if (typeof user === 'string') return [{ text: user }];
  return user.map(b => {
    const blk = b as {
      type?: string;
      text?: string;
      source?: { media_type?: string; data?: string };
    };
    if (blk.type === 'text') return { text: blk.text ?? '' };
    return { inlineData: { mimeType: blk.source?.media_type, data: blk.source?.data } };
  });
}

// Gemini's "thinking" tokens count against maxOutputTokens, so leave room for them
// or a long answer is cut off mid-JSON.
const GEMINI_THINKING_HEADROOM = 8192;

function geminiBody(opts: ToolCallOpts) {
  return {
    systemInstruction: {
      parts: [
        {
          text:
            opts.system +
            '\n\nNo tools are available. Put the answer directly in the JSON response, matching the response schema.',
        },
      ],
    },
    contents: [{ role: 'user', parts: geminiParts(opts.user) }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(opts.schema),
      maxOutputTokens: Math.min(65000, opts.maxTokens + GEMINI_THINKING_HEADROOM),
    },
  };
}

const KEY_REJECTED = /API key not valid|API_KEY_INVALID|API key expired|API key was reported/i;

/** Google's own explanation from an error body ("message [REASON]"), for the settings screen. */
function googleReason(body: string): string {
  try {
    const e = (
      JSON.parse(body) as { error?: { message?: string; details?: { reason?: string }[] } }
    ).error;
    const msg = (e?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 420);
    const reason = e?.details?.find(d => d.reason)?.reason;
    return [msg, reason && `[${reason}]`].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

// The key is fine but the Google project behind it cannot use the API yet.
const PROJECT_BLOCKED =
  /billing|free tier|quota.*not available|not available for this project|has not been used|is disabled|enable the .*api|permission_denied|service_disabled/i;

async function geminiHttpError(res: Response): Promise<AiError> {
  const text = await res.text().catch(() => '');
  const blocked = !KEY_REJECTED.test(text) && PROJECT_BLOCKED.test(googleReason(text));
  if (blocked) return new AiError(`The AI service refused the request: ${googleReason(text)}`, 502);
  if (res.status === 401 || res.status === 403 || (res.status === 400 && KEY_REJECTED.test(text)))
    return new AiError('The AI service rejected the API key configured on the server.', 502);
  if (res.status === 404)
    return new AiError('The selected AI model is not available to this API key.', 502);
  if (res.status === 429)
    return new AiError('The AI service is busy (rate limited). Try again in a moment.', 429);
  return new AiError(`The AI service returned an error (${res.status}).`, 502);
}

async function openGemini(
  opts: ToolCallOpts,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  if (!opts.cfg.apiKey)
    throw new AiError(
      'AI generation is not set up -- add an API key under Settings > Integrations.',
      503,
    );
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  let res: Response;
  try {
    res = await fetch(
      `${opts.cfg.baseUrl}/v1beta/models/${encodeURIComponent(opts.model)}:${method}`,
      {
        method: 'POST',
        cache: 'no-store',
        signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.cfg.apiKey },
        body: JSON.stringify(geminiBody(opts)),
      },
    );
  } catch {
    throw new AiError('Could not reach the AI service. Try again in a moment.', 502);
  }
  if (!res.ok) throw await geminiHttpError(res);
  return res;
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** The visible text of one response (or stream chunk); thinking parts are skipped. */
function geminiText(chunk: GeminiChunk): string {
  return (chunk.candidates?.[0]?.content?.parts ?? [])
    .filter(p => typeof p.text === 'string' && !p.thought)
    .map(p => p.text)
    .join('');
}

/** A refusal reported inside an otherwise successful response. */
function geminiRefusal(chunk: GeminiChunk): AiError | null {
  if (chunk.error)
    return new AiError(chunk.error.message || 'The AI service reported an error.', 502);
  const block = chunk.promptFeedback?.blockReason;
  const finish = chunk.candidates?.[0]?.finishReason;
  if (block || (finish && /SAFETY|BLOCKLIST|PROHIBITED|RECITATION|SPII/i.test(finish)))
    return new AiError('The AI service declined this request. Try rewording the requirement.', 422);
  return null;
}

async function callGemini<T>(opts: ToolCallOpts): Promise<T> {
  const res = await openGemini(opts, false);
  const data = (await res.json().catch(() => null)) as GeminiChunk | null;
  if (!data) throw new AiError('The AI service returned an unexpected answer.', 502);
  const refusal = geminiRefusal(data);
  if (refusal) throw refusal;
  const text = geminiText(data)
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as T;
  } catch {
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS')
      throw new AiError('The AI answer was cut off. Ask for fewer cases and try again.', 502);
  }
  throw new AiError('The AI service returned an unexpected answer.', 502);
}

/** Reads a server-sent-event body, calling `handle` with each event's raw text. */
async function readEvents(res: Response, handle: (eventText: string) => void): Promise<void> {
  if (!res.body) throw new AiError('The AI service returned an unexpected answer.', 502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handle(ev);
    }
  }
  if (buf.trim()) handle(buf);
}

async function streamGemini(
  opts: ToolCallOpts,
  onCase: (raw: RawGeneratedCase) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await openGemini(opts, true, signal);
  const parser = new CaseStreamParser();
  await readEvents(res, eventText => {
    for (const line of eventText.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(line.slice(5).trim()) as GeminiChunk;
      } catch {
        continue;
      }
      const refusal = geminiRefusal(chunk);
      if (refusal) throw refusal;
      for (const raw of parser.push(geminiText(chunk))) onCase(raw as RawGeneratedCase);
    }
  });
}

// OpenAI, Ollama and every "OpenAI-compatible" server (OpenRouter, Groq, LM Studio,
// vLLM, ...) speak the same chat-completions API, so they share one code path. Like
// Gemini, they are asked for a JSON object that matches the schema; the text they
// return is the same document a Claude tool call would carry.

// Reasoning models (GPT-5, o-series) spend part of the token budget on thinking.
const OPENAI_THINKING_HEADROOM = 8192;

// Everything except Claude and Gemini (OpenAI, OpenRouter, Groq, Grok, Mistral, DeepSeek,
// Ollama, a custom server) is reached this way.
const isOpenAiStyle = (p: AiProvider) => p !== 'anthropic' && p !== 'gemini';
// Providers that run without an API key.
const keyless = (p: AiProvider) => p === 'ollama' || p === 'custom';

/** The neutral content (text, or Claude-style blocks) as chat-completions content parts. */
function openaiContent(user: string | unknown[], provider: AiProvider): string | unknown[] {
  if (typeof user === 'string') return user;
  return user.map(b => {
    const blk = b as {
      type?: string;
      text?: string;
      source?: { media_type?: string; data?: string };
    };
    if (blk.type === 'text') return { type: 'text', text: blk.text ?? '' };
    const mime = blk.source?.media_type ?? '';
    const url = `data:${mime};base64,${blk.source?.data ?? ''}`;
    if (mime === 'application/pdf') {
      // Only OpenAI itself accepts a PDF in a chat message.
      if (provider !== 'openai')
        throw new AiError(
          'This AI provider cannot read PDF files. Paste the text of the document, or attach an image.',
          422,
        );
      return { type: 'file', file: { filename: 'document.pdf', file_data: url } };
    }
    return { type: 'image_url', image_url: { url } };
  });
}

function openaiBody(opts: ToolCallOpts, stream: boolean, schemaMode: 'schema' | 'object') {
  const provider = opts.cfg.provider;
  const reasoning = provider === 'openai';
  const budget = Math.min(32000, opts.maxTokens + (reasoning ? OPENAI_THINKING_HEADROOM : 0));
  return {
    model: opts.model,
    messages: [
      {
        role: 'system',
        content:
          opts.system +
          '\n\nNo tools are available. Reply with ONE JSON object and nothing else (no prose, no code fences) that matches this JSON schema:\n' +
          JSON.stringify(opts.schema),
      },
      { role: 'user', content: openaiContent(opts.user, provider) },
    ],
    response_format:
      schemaMode === 'schema'
        ? { type: 'json_schema', json_schema: { name: opts.toolName, schema: opts.schema } }
        : { type: 'json_object' },
    // OpenAI's newer models want max_completion_tokens; other servers know max_tokens.
    ...(reasoning ? { max_completion_tokens: budget } : { max_tokens: budget }),
    ...(stream ? { stream: true } : {}),
  };
}

/** Where an OpenAI-style API lives: the configured address plus /v1. */
const openaiUrl = (cfg: AiConfig, path: string) => `${cfg.baseUrl}/v1${path}`;

function openaiHeaders(cfg: AiConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
  };
}

/** The service's own explanation from an OpenAI-style error body. */
function openaiReason(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { message?: string } | string }).error;
    const msg = typeof e === 'string' ? e : (e?.message ?? '');
    return msg.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

const OUT_OF_CREDIT = /insufficient_quota|exceeded your current quota|billing|credit/i;

function unreachable(cfg: AiConfig): AiError {
  return cfg.provider === 'ollama'
    ? new AiError(
        `Could not reach Ollama at ${cfg.baseUrl}. Check that it is running (ollama serve) and that this server can reach that address.`,
        502,
      )
    : new AiError(`Could not reach the AI service at ${cfg.baseUrl}. Try again in a moment.`, 502);
}

async function openaiHttpError(res: Response, cfg: AiConfig, text: string): Promise<AiError> {
  const why = openaiReason(text);
  if (res.status === 401 || res.status === 403)
    return new AiError('The AI service rejected the API key configured on the server.', 502);
  if (res.status === 404)
    return new AiError(
      cfg.provider === 'ollama'
        ? `Ollama does not have the model "${cfg.model}". Install it first: ollama pull ${cfg.model}`
        : 'The selected AI model is not available to this API key.',
      502,
    );
  if (res.status === 429)
    return OUT_OF_CREDIT.test(text)
      ? new AiError(
          `The AI account has no credit or quota left.${why ? ` The service said: ${why}` : ''}`,
          502,
        )
      : new AiError('The AI service is busy (rate limited). Try again in a moment.', 429);
  return new AiError(
    `The AI service returned an error (${res.status}).${why ? ` ${why}` : ''}`,
    502,
  );
}

async function openOpenAi(
  opts: ToolCallOpts,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const cfg = opts.cfg;
  if (!keyless(cfg.provider) && !cfg.apiKey)
    throw new AiError(
      'AI generation is not set up -- add an API key under Settings > Integrations.',
      503,
    );
  const send = (mode: 'schema' | 'object') =>
    fetch(openaiUrl(cfg, '/chat/completions'), {
      method: 'POST',
      cache: 'no-store',
      signal,
      headers: openaiHeaders(cfg),
      body: JSON.stringify(openaiBody(opts, stream, mode)),
    });
  let res: Response;
  try {
    res = await send('schema');
    // Some compatible servers do not know json_schema: retry with plain JSON mode
    // (the schema is also spelled out in the prompt).
    if (res.status === 400) {
      const text = await res.clone().text();
      if (/response_format|json_schema/i.test(text)) res = await send('object');
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw unreachable(cfg);
  }
  if (!res.ok) throw await openaiHttpError(res, cfg, await res.text().catch(() => ''));
  return res;
}

interface OpenAiChunk {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    delta?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  error?: { message?: string } | string;
}

function openaiRefusal(chunk: OpenAiChunk): AiError | null {
  if (chunk.error) {
    const msg = typeof chunk.error === 'string' ? chunk.error : chunk.error.message;
    return new AiError(msg || 'The AI service reported an error.', 502);
  }
  const c = chunk.choices?.[0];
  if (c?.message?.refusal || c?.delta?.refusal || c?.finish_reason === 'content_filter')
    return new AiError('The AI service declined this request. Try rewording the requirement.', 422);
  return null;
}

/** Reasoning models may put their thinking inside <think> tags; it is not part of the answer. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '');

async function callOpenAi<T>(opts: ToolCallOpts): Promise<T> {
  const res = await openOpenAi(opts, false);
  const data = (await res.json().catch(() => null)) as OpenAiChunk | null;
  if (!data) throw new AiError('The AI service returned an unexpected answer.', 502);
  const refusal = openaiRefusal(data);
  if (refusal) throw refusal;
  const text = stripThinking(data.choices?.[0]?.message?.content ?? '')
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, '');
  const candidates = [text];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first > 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      /* try the next shape */
    }
  }
  if (data.choices?.[0]?.finish_reason === 'length')
    throw new AiError('The AI answer was cut off. Ask for fewer cases and try again.', 502);
  throw new AiError('The AI service returned an unexpected answer.', 502);
}

async function streamOpenAi(
  opts: ToolCallOpts,
  onCase: (raw: RawGeneratedCase) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await openOpenAi(opts, true, signal);
  const parser = new CaseStreamParser();
  let cutOff = false;
  await readEvents(res, eventText => {
    for (const line of eventText.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(payload) as OpenAiChunk;
      } catch {
        continue;
      }
      const refusal = openaiRefusal(chunk);
      if (refusal) throw refusal;
      if (chunk.choices?.[0]?.finish_reason === 'length') cutOff = true;
      for (const raw of parser.push(chunk.choices?.[0]?.delta?.content ?? ''))
        onCase(raw as RawGeneratedCase);
    }
  });
  if (cutOff)
    throw new AiError('The AI answer was cut off. Ask for fewer cases and try again.', 502);
}

/**
 * One forced tool call: the model must answer by calling `toolName` with input
 * matching `schema`, which is returned already parsed.
 */
async function callTool<T>(opts: ToolCallOpts): Promise<T> {
  if (opts.cfg.provider === 'gemini') return callGemini<T>(opts);
  if (isOpenAiStyle(opts.cfg.provider)) return callOpenAi<T>(opts);
  const res = await openMessages(opts, false);
  const data = (await res.json().catch(() => null)) as {
    content?: { type: string; input?: unknown }[];
  } | null;
  const block = data?.content?.find(b => b.type === 'tool_use');
  if (!block || block.input == null || typeof block.input !== 'object')
    throw new AiError('The AI service returned an unexpected answer.', 502);
  return block.input as T;
}

/** Calls the model and returns the raw (unvalidated) cases. */
export async function generateRawCases(
  req: GenerateRequest,
  cfg: AiConfig,
): Promise<RawGeneratedCase[]> {
  const out = await callTool<{ cases?: unknown }>({
    cfg,
    model: cfg.model,
    system: systemPrompt(req),
    user: userContent(req),
    toolName: 'return_cases',
    description: 'Return the generated test cases.',
    schema: toolSchema(req),
    maxTokens: Math.min(16000, 800 + req.count * 600),
  });
  if (!Array.isArray(out.cases))
    throw new AiError('The AI service returned an unexpected answer.', 502);
  return out.cases as RawGeneratedCase[];
}

/**
 * Same request as generateRawCases, but streamed: `onCase` is called with each
 * test case the moment the model finishes writing it. Resolves when the model is
 * done; throws an AiError if the service reports a failure part-way (cases that
 * were already delivered stay delivered).
 */
export async function streamRawCases(
  req: GenerateRequest,
  cfg: AiConfig,
  onCase: (raw: RawGeneratedCase) => void,
  signal?: AbortSignal,
): Promise<void> {
  const callOpts: ToolCallOpts = {
    cfg,
    model: cfg.model,
    system: systemPrompt(req),
    user: userContent(req),
    toolName: 'return_cases',
    description: 'Return the generated test cases.',
    schema: toolSchema(req),
    maxTokens: Math.min(16000, 800 + req.count * 600),
  };
  if (cfg.provider === 'gemini') return streamGemini(callOpts, onCase, signal);
  if (isOpenAiStyle(cfg.provider)) return streamOpenAi(callOpts, onCase, signal);
  const res = await openMessages(callOpts, true, signal);
  if (!res.body) throw new AiError('The AI service returned an unexpected answer.', 502);

  const parser = new CaseStreamParser();
  const handle = (eventText: string) => {
    for (const line of eventText.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let ev: {
        type?: string;
        delta?: { type?: string; partial_json?: string };
        error?: { message?: string };
      };
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === 'error')
        throw new AiError(ev.error?.message || 'The AI service reported an error.', 502);
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
        for (const raw of parser.push(ev.delta.partial_json ?? '')) onCase(raw as RawGeneratedCase);
      }
    }
  };

  await readEvents(res, handle);
}

// ─── Duplicate judging ─────────────────────────────────────────────────────

export interface JudgeInput {
  generated: { title: string; steps: string[] }[];
  /** Existing cases to look through (title only keeps the request small). */
  existing: { caseNum: number; title: string }[];
}

export interface JudgeVerdict {
  /** Index into `generated`. */
  index: number;
  /** caseNum of the existing case that covers the same scenario, or null. */
  existingCaseNum: number | null;
  relation: 'same' | 'overlap' | 'different';
}

/**
 * Asks a (cheap) model which existing case, if any, covers the SAME scenario as
 * each generated case -- catching reworded duplicates the wording check can't,
 * and rejecting look-alikes that test something different ("valid password" vs
 * "wrong password"). Callers must treat failure as "no opinion".
 */
export async function judgeDuplicates(input: JudgeInput, cfg: AiConfig): Promise<JudgeVerdict[]> {
  const system = [
    'You compare proposed test cases with existing ones in a test management tool.',
    'For each proposed case (G1, G2, ...) decide whether an existing case (by its number) covers the SAME scenario.',
    '- relation "same": the existing case tests the same behaviour with the same expected outcome, however it is worded.',
    '- relation "overlap": largely the same scenario with minor extra or missing checks.',
    '- relation "different": no existing case tests this. Choose this when the cases only look similar but test different behaviour (for example a valid input versus an invalid input).',
    'Use existingCaseNum null with relation "different" when nothing matches. Answer only by calling the tool, once per proposed case.',
  ].join('\n');
  const user = [
    'EXISTING CASES:',
    ...input.existing.map(e => `E${e.caseNum}: ${e.title}`),
    '',
    'PROPOSED CASES:',
    ...input.generated.map(
      (g, i) => `G${i + 1}: ${g.title} -- steps: ${g.steps.slice(0, 5).join(' > ')}`,
    ),
  ].join('\n');

  const out = await callTool<{ verdicts?: unknown }>({
    cfg,
    model: cfg.tiebreakModel,
    system,
    user,
    toolName: 'return_verdicts',
    description: 'Return one verdict per proposed case.',
    schema: {
      type: 'object',
      properties: {
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              proposed: { type: 'integer', description: 'The number after G.' },
              existingCaseNum: { type: ['integer', 'null'], description: 'The number after E.' },
              relation: { type: 'string', enum: ['same', 'overlap', 'different'] },
            },
            required: ['proposed', 'existingCaseNum', 'relation'],
          },
        },
      },
      required: ['verdicts'],
    },
    maxTokens: 400 + input.generated.length * 60,
  });
  if (!Array.isArray(out.verdicts)) return [];
  const known = new Set(input.existing.map(e => e.caseNum));
  const result: JudgeVerdict[] = [];
  for (const v of out.verdicts as {
    proposed?: unknown;
    existingCaseNum?: unknown;
    relation?: unknown;
  }[]) {
    const idx = typeof v.proposed === 'number' ? v.proposed - 1 : -1;
    if (idx < 0 || idx >= input.generated.length) continue;
    const relation =
      v.relation === 'same' || v.relation === 'overlap' || v.relation === 'different'
        ? v.relation
        : null;
    if (!relation) continue;
    const num = typeof v.existingCaseNum === 'number' ? v.existingCaseNum : null;
    // A "match" to a case we never listed is a hallucination -- treat as different.
    const valid = num !== null && known.has(num);
    result.push({
      index: idx,
      existingCaseNum: valid ? num : null,
      relation: valid ? relation : 'different',
    });
  }
  return result;
}

// ─── Improving an existing case ────────────────────────────────────────────

export interface ReviseRequest {
  /** What the user asked for, e.g. "Login now needs an OTP step". */
  instruction: string;
  /** "Portal > Module > Suite" -- context only. */
  parentPath: string;
  /** The case as it is now (option values are display names). */
  current: {
    title: string;
    desc: string;
    preconditions: string;
    steps: string[];
    expected: string;
    priority: string;
    severity: string;
    type: string;
    labels: string[];
  };
  options: OptionNames;
}

/**
 * Asks the model to apply ONE instruction to ONE existing case and return the
 * complete revised case. The caller diffs it against the current case, so fields
 * the model did not touch simply come back unchanged.
 */
export async function reviseCase(req: ReviseRequest, cfg: AiConfig): Promise<unknown> {
  const system = [
    'You edit ONE manual test case in a test management tool.',
    "Apply ONLY the user's instruction, then return the COMPLETE case by calling the return_revision tool.",
    'Copy every field the instruction does not affect EXACTLY as given. Do not reword, reorder, shorten or "improve" anything you were not asked to change.',
    'Keep the existing style: steps are short imperative actions; keep the same language and level of detail.',
    `priority must be one of: ${req.options.priority.join(', ')}. severity must be one of: ${req.options.severity.join(', ')}. type must be one of: ${req.options.type.join(', ')}. Keep the current value unless the instruction is about it.`,
    'summary: one short sentence saying what you changed. If the instruction does not apply to this case, return the case unchanged and set summary to "No change needed" plus a few words on why.',
    'Never add real personal data, passwords or secrets; use placeholders.',
  ].join('\n');

  const user = [
    `Location in the product: ${req.parentPath || '(not specified)'}`,
    '',
    'INSTRUCTION:',
    '"""',
    req.instruction.trim(),
    '"""',
    '',
    'CURRENT CASE (json):',
    JSON.stringify(req.current, null, 2),
  ].join('\n');

  const caseProps = {
    title: { type: 'string' },
    desc: { type: 'string' },
    preconditions: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    expected: { type: 'string' },
    priority: { type: 'string', enum: req.options.priority },
    severity: { type: 'string', enum: req.options.severity },
    type: { type: 'string', enum: req.options.type },
    labels: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  };

  return callTool<unknown>({
    cfg,
    model: cfg.model,
    system,
    user,
    toolName: 'return_revision',
    description: 'Return the complete revised test case.',
    schema: {
      type: 'object',
      properties: caseProps,
      required: [
        'title',
        'desc',
        'preconditions',
        'steps',
        'expected',
        'priority',
        'severity',
        'type',
        'labels',
        'summary',
      ],
    },
    maxTokens: 3000,
  });
}

// ─── Key check ─────────────────────────────────────────────────────────────

/**
 * Confirms a key (and model) really work, with the smallest possible request, so a
 * typo is caught when the admin saves it -- not later, in front of a tester.
 * A rate-limit answer still proves the key is valid.
 */
export async function verifyAiKey(cfg: AiConfig): Promise<void> {
  if (cfg.provider === 'gemini') return verifyGeminiKey(cfg);
  if (isOpenAiStyle(cfg.provider)) return verifyOpenAiKey(cfg);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
  } catch {
    throw new AiError("Could not reach the AI service. Check the server's internet access.", 502);
  }
  if (res.status === 401 || res.status === 403)
    throw new AiError('That API key was rejected by the AI service. Check it and try again.', 400);
  if (res.status === 404)
    throw new AiError(`The model "${cfg.model}" is not available to this key.`, 400);
  if (res.status === 429 || res.ok) return;
  throw new AiError(`The AI service returned an error (${res.status}).`, 502);
}

const VERIFY_TIMEOUT_MS = 20_000;

async function verifyGeminiKey(cfg: AiConfig): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      {
        method: 'POST',
        cache: 'no-store',
        // Never leave the settings screen spinning if the AI service stalls.
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError')
      throw new AiError(
        `The AI service did not answer within ${VERIFY_TIMEOUT_MS / 1000} seconds. Check the key and model (try another model), then try again.`,
        504,
      );
    throw new AiError("Could not reach the AI service. Check the server's internet access.", 502);
  }
  if (res.status === 429 || res.ok) return;
  const text = await res.text().catch(() => '');
  const why = googleReason(text);
  if (!KEY_REJECTED.test(text) && PROJECT_BLOCKED.test(why))
    throw new AiError(
      `Google accepted the key but will not let this project use the Gemini API yet. Google said: ${why}`,
      400,
    );
  if (res.status === 401 || res.status === 403 || (res.status === 400 && KEY_REJECTED.test(text))) {
    throw new AiError(
      'That API key was rejected by the AI service. Check it and try again.' +
        (why ? ` Google said: ${why}` : ''),
      400,
    );
  }
  if (res.status === 404) {
    const usable = await listGeminiModels(cfg);
    throw new AiError(
      `The model "${cfg.model}" is not available to this key.` +
        (usable.length ? ` Models this key can use: ${usable.join(', ')}.` : ''),
      400,
    );
  }
  throw new AiError(`The AI service returned an error (${res.status}).`, 502);
}

/** Text-generation Gemini models this key can call (best effort, newest names first). */
async function listGeminiModels(cfg: AiConfig): Promise<string[]> {
  try {
    const res = await fetch(`${cfg.baseUrl}/v1beta/models?pageSize=200`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
      headers: { 'x-goog-api-key': cfg.apiKey },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const ids = (data.models ?? [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => (m.name ?? '').replace(/^models\//, ''))
      .filter(
        id => /^gemini-/.test(id) && !/embedding|tts|image|live|audio|robotics|computer/.test(id),
      );
    // "-latest" aliases and short names first; dated / numbered variants after.
    ids.sort((a, b) => Number(/latest/.test(b)) - Number(/latest/.test(a)) || a.length - b.length);
    return ids.slice(0, 8);
  } catch {
    return [];
  }
}

/** Models the service says it has (best effort): Ollama's installed list, or /v1/models. */
async function listOpenAiModels(cfg: AiConfig): Promise<string[]> {
  try {
    const signal = AbortSignal.timeout(8_000);
    if (cfg.provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl}/api/tags`, { cache: 'no-store', signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: { name?: string }[] };
      return (data.models ?? [])
        .map(m => m.name ?? '')
        .filter(Boolean)
        .slice(0, 10);
    }
    const res = await fetch(openaiUrl(cfg, '/models'), {
      cache: 'no-store',
      signal,
      headers: openaiHeaders(cfg),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .map(m => m.id ?? '')
      .filter(
        id =>
          // OpenAI lists dozens of non-chat models; other services mostly list chat models.
          (cfg.provider !== 'openai' || /^(gpt-|o\d|chatgpt)/.test(id)) &&
          !/embed|tts|whisper|image|audio|realtime|moderation|transcribe|guard/.test(id),
      )
      .sort((a, b) => a.length - b.length)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function verifyOpenAiKey(cfg: AiConfig): Promise<void> {
  // A local model may have to be loaded into memory first, which takes a while.
  const limit = cfg.provider === 'ollama' ? 90_000 : VERIFY_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(openaiUrl(cfg, '/chat/completions'), {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(limit),
      headers: openaiHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        ...(cfg.provider === 'openai' ? { max_completion_tokens: 16 } : { max_tokens: 16 }),
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError')
      throw new AiError(
        `The AI service did not answer within ${limit / 1000} seconds. Check the address and model, then try again.`,
        504,
      );
    throw unreachable(cfg);
  }
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  const why = openaiReason(text);
  if (res.status === 429 && !OUT_OF_CREDIT.test(text)) return; // busy, but the key is valid
  if (res.status === 401 || res.status === 403)
    throw new AiError(
      `That API key was rejected by the AI service. Check it and try again.${why ? ` The service said: ${why}` : ''}`,
      400,
    );
  if (res.status === 404 || (res.status === 400 && /model/i.test(why))) {
    const have = await listOpenAiModels(cfg);
    throw new AiError(
      cfg.provider === 'ollama'
        ? `Ollama does not have the model "${cfg.model}".` +
            (have.length
              ? ` Installed models: ${have.join(', ')}.`
              : ` Install it first: ollama pull ${cfg.model}`)
        : `The model "${cfg.model}" is not available to this key.` +
            (have.length ? ` Models this key can use: ${have.join(', ')}.` : ''),
      400,
    );
  }
  if (res.status === 429)
    throw new AiError(
      `The AI account has no credit or quota left.${why ? ` The service said: ${why}` : ''}`,
      400,
    );
  throw new AiError(
    `The AI service returned an error (${res.status}).${why ? ` ${why}` : ''}`,
    502,
  );
}

// ─── Validation ────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Case-insensitive match of a model-supplied name against the allowed names. */
function pick(v: unknown, allowed: string[], fallback: string): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return allowed.find(a => a.toLowerCase() === s) ?? fallback;
}

// Steps that try to talk to the system instead of describing a test.
const SUSPICIOUS = /ignore (all |any )?(previous|prior|above) instructions|system prompt/i;

/**
 * Turns what the model returned into cases the app can save: trimmed, bounded,
 * options mapped to real workspace option names, and anything unusable dropped.
 */
export function validateGenerated(
  raw: RawGeneratedCase[],
  options: OptionNames,
  max: number,
): GeneratedCase[] {
  const out: GeneratedCase[] = [];
  const seen = new Set<string>();
  const dflt = (list: string[], pref: string) =>
    list.find(x => x.toLowerCase() === pref.toLowerCase()) ?? list[0] ?? pref;

  for (const r of raw) {
    const title = str(r.title, 160);
    const steps = (Array.isArray(r.steps) ? r.steps : [])
      .map(s => str(s, 400))
      .filter(Boolean)
      .slice(0, 15);
    if (!title || steps.length === 0) continue;
    if (SUSPICIOUS.test(title) || steps.some(s => SUSPICIOUS.test(s))) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      desc: str(r.desc, 1000),
      preconditions: str(r.preconditions, 1000),
      steps,
      expected: str(r.expected, 1000),
      priority: pick(r.priority, options.priority, dflt(options.priority, 'Medium')),
      severity: pick(r.severity, options.severity, dflt(options.severity, 'Minor')),
      type: pick(r.type, options.type, dflt(options.type, 'Functional')),
      labels: (Array.isArray(r.labels) ? r.labels : [])
        .map(l => str(l, 30).toLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean)
        .slice(0, 3),
    });
    if (out.length >= max) break;
  }
  return out;
}
