/**
 * Batch entry point (Section 9 — mandatory).
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Reads an array of { id, jd, company_url, days }, runs the SAME pipeline the
 * app uses (research -> requirements -> brief/role -> questions -> flashcards
 * -> coverage loop -> schedule), and writes Appendix B shaped JSON.
 * One case failing does not abort the run. No DB or server needed.
 */
import fs from 'fs';
import path from 'path';
import { runPipeline } from '../services/pipeline';
import type { KitDocKit } from '../models/Kit';

interface EvalCase {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

interface OutputCase {
  id: string;
  status: 'ok' | 'failed';
  kit: KitDocKit | null;
  error: { code: string; message: string } | null;
}

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const input = get('--input');
  const output = get('--output');
  if (!input || !output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(2);
  }
  return { input, output };
}

async function evaluateCase(c: EvalCase): Promise<OutputCase> {
  if (!c.id || typeof c.jd !== 'string' || !c.company_url || !Number.isInteger(c.days) || c.days < 1) {
    return {
      id: String(c?.id ?? 'unknown'),
      status: 'failed',
      kit: null,
      error: { code: 'BAD_CASE', message: 'Case must have id, jd, company_url and integer days >= 1' },
    };
  }

  try {
    const kit = await runPipeline(
      { jd: c.jd, company_url: c.company_url, days: c.days },
      (phase, message) => {
        console.log(`  [${c.id}] ${phase}: ${message}`);
      }
    );
    return { id: c.id, status: 'ok', kit, error: null };
  } catch (err) {
    return {
      id: c.id,
      status: 'failed',
      kit: null,
      error: {
        code: err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'GENERATION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function main() {
  const { input, output } = parseArgs();

  const raw = fs.readFileSync(path.resolve(input), 'utf-8');
  let cases: EvalCase[];
  try {
    cases = JSON.parse(raw);
    if (!Array.isArray(cases)) throw new Error('not an array');
  } catch (err) {
    console.error(`[evaluate] input file is not a JSON array of cases: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  console.log(`[evaluate] running ${cases.length} case(s)`);
  const kits: OutputCase[] = [];
  let failures = 0;

  for (const c of cases) {
    console.log(`[evaluate] case ${c.id} …`);
    const result = await evaluateCase(c);
    if (result.status === 'failed') failures += 1;
    kits.push(result);
    console.log(`[evaluate] case ${c.id}: ${result.status}`);
  }

  const out = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits,
  };

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), JSON.stringify(out, null, 2) + '\n');
  console.log(`[evaluate] wrote ${kits.length} kit(s) (${failures} failed) to ${output}`);
  process.exit(failures === cases.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[evaluate] fatal', err);
  process.exit(1);
});
