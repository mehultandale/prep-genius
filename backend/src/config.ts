import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // backend-local override

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/prep-genius'),
  sessionSecret: required('SESSION_SECRET', 'dev-only-insecure-secret'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',

  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',

  llmMaxConcurrency: parseInt(process.env.LLM_MAX_CONCURRENCY ?? '2', 10),
  llmMinRequestIntervalMs: parseInt(process.env.LLM_MIN_REQUEST_INTERVAL_MS ?? '4000', 10),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '5', 10),

  crawlMaxPages: parseInt(process.env.CRAWL_MAX_PAGES ?? '12', 10),

  pythonBin: process.env.PYTHON_BIN ?? 'python3',
  scrapingDir: path.resolve(__dirname, '..', process.env.SCRAPING_DIR ?? 'scraping'),
};

export type AppConfig = typeof config;
