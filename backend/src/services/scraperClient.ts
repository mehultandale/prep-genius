/**
 * Bridge from Node to the Python scraping layer (backend/scraping).
 * Each call spawns `python3 main.py` with a JSON request on stdin and reads
 * one JSON object from stdout. Keeps the protocol trivial and robust.
 */
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../config';

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  kind: string;
}

export interface DiscussionResult {
  results: Array<{ url: string; title?: string; subreddit?: string }>;
  threads: Array<{ url: string; title: string; body: string }>;
  errors: string[];
}

function callPython<T>(request: Record<string, unknown>, timeoutMs = 180_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const script = path.join(config.scrapingDir, 'main.py');
    const proc = spawn(config.pythonBin, [script], {
      cwd: config.scrapingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Scraping helper timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start Python (${config.pythonBin}). Is it installed? ${err.message}`));
    });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.ok) resolve(parsed as T);
        else reject(new Error(parsed.error ?? 'Scraping helper failed'));
      } catch {
        reject(new Error(`Scraping helper returned invalid output: ${stderr.slice(0, 300)}`));
      }
    });

    proc.stdin.write(JSON.stringify(request));
    proc.stdin.end();
  });
}

export async function crawlCompany(url: string, maxPages = config.crawlMaxPages) {
  const res = await callPython<{ pages: CrawledPage[]; errors: string[] }>({
    op: 'crawl_company',
    url,
    max_pages: maxPages,
  });
  return res;
}

export async function searchDiscussion(company: string, roleHint = '') {
  const res = await callPython<DiscussionResult>({ op: 'search_discussion', company, role_hint: roleHint });
  return res;
}

export async function fetchPage(url: string) {
  const res = await callPython<{ page: { url: string; title: string; text: string; links: unknown[] } }>({
    op: 'fetch_page',
    url,
  });
  return res.page;
}
