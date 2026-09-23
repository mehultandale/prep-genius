/**
 * Gemini LLM service with free-tier resilience:
 *  - global concurrency cap + minimum interval between requests (tokens/min safety)
 *  - exponential backoff with jitter on 429/5xx, honouring Retry-After
 *  - tolerant JSON extraction (models sometimes wrap JSON in prose/fences)
 *  - grounded generation via google_search tool for research-flavoured steps
 */
import { GoogleGenAI } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';
import { config } from '../config';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

// ── Pacing (token-per-minute buckets make short bursts fatal; space calls out) ─
let active = 0;
let lastStart = 0;
const queue: Array<() => void> = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquireSlot(): Promise<void> {
  if (active < config.llmMaxConcurrency && Date.now() - lastStart >= config.llmMinRequestIntervalMs) {
    active += 1;
    lastStart = Date.now();
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
  lastStart = Date.now();
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) {
    const wait = Math.max(0, config.llmMinRequestIntervalMs - (Date.now() - lastStart));
    setTimeout(next, wait);
  }
}

// ── JSON extraction ───────────────────────────────────────────────────────────
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const attempts: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1].trim());

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace > 0) attempts.push(trimmed.slice(firstBrace));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next strategy
    }
  }
  // Last resort: trim to the matching final brace/bracket.
  const openCh = trimmed.includes('[') && !trimmed.includes('{') ? '[' : '{';
  const closeCh = openCh === '[' ? ']' : '}';
  const start = trimmed.indexOf(openCh);
  const end = trimmed.lastIndexOf(closeCh);
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error('Model returned invalid JSON');
}

export interface LlmRequestOptions {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  grounded?: boolean; // enable google_search grounding for research steps
  label?: string;
}

export async function generateJson<T>(prompt: string, opts: LlmRequestOptions = {}): Promise<T> {
  const ai = getClient();
  const maxRetries = config.llmMaxRetries;
  let delay = 1500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await acquireSlot();
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.4,
          maxOutputTokens: opts.maxOutputTokens ?? 8192,
          ...(opts.grounded ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

      const text = response.text ?? '';
      if (!text.trim()) throw new Error('Empty model response');
      return extractJson(text) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRate = /429|resource_exhausted|quota|rate/i.test(message);
      const isTransient = /5\d\d|unavailable|deadline|eof|reset|timeout/i.test(message) || isRate;
      if (attempt < maxRetries && (isTransient || isRate)) {
        const retryAfterMs = parseRetryAfter(err);
        await sleep(retryAfterMs ?? delay + Math.random() * 800);
        delay = Math.min(delay * 2, 30_000);
        continue;
      }
      throw new Error(`[${opts.label ?? 'llm'}] ${message}`);
    } finally {
      releaseSlot();
    }
  }
  throw new Error(`[${opts.label ?? 'llm'}] exhausted retries`);
}

function parseRetryAfter(err: unknown): number | null {
  const anyErr = err as { response?: { headers?: Record<string, string> }; cause?: { response?: { headers?: Record<string, string> } } };
  const headers = anyErr?.response?.headers ?? anyErr?.cause?.response?.headers;
  const ra = headers?.['retry-after'];
  if (ra && !Number.isNaN(Number(ra))) return Number(ra) * 1000;
  return null;
}
