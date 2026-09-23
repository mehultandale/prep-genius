/**
 * The kit generation pipeline — deliberate, staged, model-assisted where it
 * helps and deterministic where the brief demands it.
 *
 * Stages:
 *   1. research: crawl company site (Scrapy), search public discussion
 *   2. extract requirements from the JD (LLM, strict schema)
 *   3. brief + role draft (LLM, grounded on crawled pages)
 *   4. questions per category, conditioned on requirement kind (LLM)
 *   5. flashcards from requirements (LLM)
 *   6. deterministic coverage check -> gap list -> targeted regeneration loop
 *      (must-have coverage must reach 100%; passes recorded honestly)
 *   7. schedule built by arithmetic (code, not model)
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Kit } from '../models/Kit';
import type { KitDoc, KitDocKit } from '../models/Kit';
import {
  RequirementSchema, QuestionSchema, FlashcardSchema,
  type Requirement, type Question, type Flashcard,
} from '../types/kit';
import { generatedState, type Stateful } from '../types/state';
import { generateJson } from './llm';
import { crawlCompany, searchDiscussion, type CrawledPage } from './scraperClient';
import { buildSchedule, computeCoverage } from './schedule';

const MAX_COVERAGE_PASSES = 4;

export interface PipelineInput {
  jd: string;
  company_url: string;
  days: number;
}

export class PipelineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type ProgressFn = (phase: string, message: string) => Promise<void> | void;

// ── Schemas for model outputs ─────────────────────────────────────────────────
const RequirementsOut = z.object({ requirements: z.array(RequirementSchema).min(0) });
const RoleOut = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
});
const BriefOut = z.object({ summary: z.string(), what_they_do: z.string(), sources: z.array(z.string()).default([]) });
const QuestionsOut = z.object({ questions: z.array(QuestionSchema.omit({ id: true })).min(0) });
const FlashcardsOut = z.object({ flashcards: z.array(FlashcardSchema.omit({ id: true })).min(0) });

const JOB_CONTEXT_SYSTEM = `You are an interview-preparation researcher. Be factual and conservative:
never invent facts about a company; if information is missing, say so plainly in the output rather than fabricating.
Always reply with a single JSON object and nothing else — no prose, no markdown fences.`;

// ── Stage 1: research ─────────────────────────────────────────────────────────
export interface ResearchResult {
  pages: CrawledPage[];
  discussion: {
    results: Array<{ url: string; title?: string }>;
    threads: Array<{ url: string; title: string; body: string }>;
    errors: string[];
  };
  pageErrors: string[];
}

export async function researchCompany(
  companyUrl: string,
  onProgress: ProgressFn
): Promise<ResearchResult> {
  await onProgress('researching_company', `Crawling ${companyUrl} …`);
  const crawled = await crawlCompany(companyUrl).catch((err) => {
    return { pages: [] as CrawledPage[], errors: [String(err instanceof Error ? err.message : err)] };
  });

  let company = hostToName(companyUrl);
  const briefish = crawled.pages.find((p) => p.kind === 'about' || p.kind === 'home');
  if (briefish?.title) company = briefish.title.split(/[|\-–—]/)[0].trim() || company;

  await onProgress('searching_discussion', 'Looking for public interview discussion …');
  const discussion = await searchDiscussion(company).catch((err) => ({
    results: [] as DiscussionResultLike['results'],
    threads: [] as DiscussionResultLike['threads'],
    errors: [String(err instanceof Error ? err.message : err)],
  }));

  const pageErrors = crawled.errors;
  return { pages: crawled.pages, discussion, pageErrors };
}

interface DiscussionResultLike {
  results: Array<{ url: string; title?: string }>;
  threads: Array<{ url: string; title: string; body: string }>;
  errors: string[];
}

function hostToName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'The company';
  }
}

// ── Stage 2: requirements ─────────────────────────────────────────────────────
export async function extractRequirements(jd: string, onProgress: ProgressFn): Promise<Requirement[]> {
  await onProgress('extracting_requirements', 'Extracting role requirements …');
  const out = await generateJson<{ requirements: Requirement[] }>(
    `Extract the requirements from this job description.

Rules:
- One entry per distinct requirement; quote or closely paraphrase the JD.
- "kind": "technical" | "behavioural" | "domain".
- "priority": "must" if the posting says required/essential/must-have; "nice" for bonus/preferred phrases.
- Do NOT invent requirements that are not in the text. A thin JD should yield few requirements.
- ids: r1, r2, … in order.

JD:
"""
${jd.slice(0, 9000)}
"""`,
    { system: JOB_CONTEXT_SYSTEM, label: 'requirements', temperature: 0.1, maxOutputTokens: 4096 }
  );
  const parsed = RequirementsOut.safeParse(out);
  if (!parsed.success) throw new PipelineError('GENERATION_INVALID', 'Could not parse requirements from model output');
  return parsed.data.requirements.map((r, i) => ({ ...r, id: r.id || `r${i + 1}` }));
}

// ── Stage 3: brief + role metadata ────────────────────────────────────────────
export async function draftBriefAndRole(
  jd: string,
  research: ResearchResult,
  onProgress: ProgressFn
): Promise<{ brief: { summary: string; what_they_do: string; sources: string[] }; roleMeta: z.infer<typeof RoleOut> }> {
  await onProgress('generating_brief', 'Drafting company brief and role summary …');

  const pageDigest = research.pages
    .slice(0, 8)
    .map((p, i) => `[${i + 1}] ${p.title || p.url} (${p.kind})\n${p.text.slice(0, 1200)}`)
    .join('\n\n');

  const discussionDigest = research.discussion.threads
    .map((t) => `Thread: ${t.title}\n${t.body.slice(0, 1500)}`)
    .join('\n\n');

  const out = await generateJson<{ brief: z.infer<typeof BriefOut>; role: z.infer<typeof RoleOut> }>(
    `Research material about a company, then the job description. Produce:
1. "brief": {"summary": 2-3 sentence company summary, "what_they_do": what the company does}
2. "role": {"title", "seniority" (e.g. junior/mid/senior/staff), "responsibilities": [strings]}

Rules:
- Use ONLY the research material for company facts. If material is thin, say so honestly (e.g. "Public information was limited…"). Never invent facts.
- "sources": list the URLs you actually used.
- Role info comes from the JD only.

RESEARCH PAGES:
${pageDigest || '(company site unreachable — say so honestly)'}

PUBLIC DISCUSSION:
${discussionDigest || '(none found — do not invent any)'}

JOB DESCRIPTION:
"""
${jd.slice(0, 6000)}
"""

Reply with JSON: {"brief": {"summary","what_they_do","sources":[urls]}, "role": {"title","seniority","responsibilities":[]}}`,
    { system: JOB_CONTEXT_SYSTEM, label: 'brief_role', temperature: 0.3, maxOutputTokens: 4096 }
  );

  const sources = (out.brief?.sources ?? [])
    .filter((u: unknown): u is string => typeof u === 'string')
    .filter((u: string) => research.pages.some((p) => p.url === u) || research.discussion.results.some((r) => r.url === u));
  const usedSources = sources.length
    ? sources
    : research.pages.slice(0, 5).map((p) => p.url);

  return {
    brief: { ...out.brief, sources: usedSources },
    roleMeta: out.role,
  };
}

// ── Stage 4: questions ────────────────────────────────────────────────────────
function requirementPrompt(
  reqs: Requirement[],
  category: 'technical' | 'behavioural' | 'system-design' | 'company-fit',
  research: ResearchResult
): string {
  const processNote = research.discussion.threads.length
    ? `The company's interview process reportedly involves:\n${research.discussion.threads
        .slice(0, 2)
        .map((t) => `- ${t.title}: ${t.body.slice(0, 600)}`)
        .join('\n')}`
    : 'No public information about their interview process was found; make questions generic for the category.';

  return `Generate interview questions for these requirements, all in the "${category}" category.

${processNote}

Requirements (id: text — priority):
${reqs.map((r) => `- ${r.id}: ${r.text} [${r.priority}]`).join('\n')}

Rules:
- Each question covers one or more requirement ids from the list above (use exact ids).
- "category" must be "${category}" for every question.
- "difficulty": 1 (easy) | 2 (medium) | 3 (hard), sensible for the seniority.
- "answer_outline": 2-4 sentences an interviewee could expand on.
- 2-4 questions per requirement, no more.

Reply with JSON: {"questions": [{"requirement_ids":["r1"],"category":"${category}","prompt":"…","answer_outline":"…","difficulty":2}]}`;
}

export async function generateQuestionsForRequirements(
  reqs: Requirement[],
  category: 'technical' | 'behavioural' | 'system-design' | 'company-fit',
  research: ResearchResult,
  onProgress: ProgressFn,
  idPrefix: string
): Promise<Question[]> {
  if (reqs.length === 0) return [];
  await onProgress('generating_questions', `Generating ${category} questions for ${reqs.length} requirement(s) …`);

  const out = await generateJson<{ questions: Array<Omit<Question, 'id'>> }>(
    requirementPrompt(reqs, category, research),
    { system: JOB_CONTEXT_SYSTEM, label: `questions:${category}`, temperature: 0.5, maxOutputTokens: 8192 }
  );

  return out.questions.map((q, i) => ({
    ...q,
    id: `${idPrefix}${i + 1}`,
    requirement_ids: (q.requirement_ids ?? []).filter((rid) => reqs.some((r) => r.id === rid)),
  }));
}

// ── Stage 5: flashcards ───────────────────────────────────────────────────────
export async function generateFlashcards(
  requirements: Requirement[],
  questions: Question[],
  onProgress: ProgressFn
): Promise<Flashcard[]> {
  await onProgress('generating_flashcards', 'Generating flashcards …');
  const out = await generateJson<{ flashcards: Array<Omit<Flashcard, 'id'>> }>(
    `Create revision flashcards for an interview prep kit.

Requirements:
${requirements.map((r) => `- ${r.id}: ${r.text}`).join('\n') || '(none)'}

Question prompts (for style only):
${questions.slice(0, 10).map((q) => `- ${q.prompt.slice(0, 120)}`).join('\n')}

Rules:
- 1-2 flashcards per requirement; front = concept/question, back = concise answer or definition.
- Link each card to requirement ids it helps revise (exact ids from the list).
- Do not invent requirements.

Reply with JSON: {"flashcards": [{"front":"…","back":"…","requirement_ids":["r1"]}]}`,
    { system: JOB_CONTEXT_SYSTEM, label: 'flashcards', temperature: 0.4, maxOutputTokens: 4096 }
  );

  return (out.flashcards ?? []).map((f, i) => ({
    ...f,
    id: `f${i + 1}`,
    requirement_ids: (f.requirement_ids ?? []).filter((rid) => requirements.some((r) => r.id === rid)),
  }));
}

// ── Assembling + coverage loop ────────────────────────────────────────────────
let questionSeq = 0;
function nextQuestionId(): string {
  questionSeq += 1;
  return `q${questionSeq}_${randomUUID().slice(0, 4)}`;
}

export async function runPipeline(
  input: PipelineInput,
  onProgress: ProgressFn
): Promise<KitDocKit> {
  const { jd, company_url, days } = input;

  // 1–2. Research + requirements (research failure is recorded, not fatal).
  const research = await researchCompany(company_url, onProgress);
  const requirements = await extractRequirements(jd, onProgress);
  if (requirements.length === 0) {
    throw new PipelineError('JD_EMPTY', 'No requirements could be extracted from the job description');
  }

  const { brief, roleMeta } = await draftBriefAndRole(jd, research, onProgress);

  // 4. Questions by category, driven by requirement kind.
  const technicalReqs = requirements.filter((r) => r.kind === 'technical');
  const behaviouralReqs = requirements.filter((r) => r.kind === 'behavioural');
  const domainReqs = requirements.filter((r) => r.kind === 'domain');

  const questions: Question[] = [];
  const buckets: Array<{
    reqs: Requirement[];
    category: 'technical' | 'behavioural' | 'system-design' | 'company-fit';
  }> = [
    { reqs: technicalReqs, category: 'technical' },
    { reqs: domainReqs, category: 'company-fit' },
    { reqs: domainReqs, category: 'system-design' },
    { reqs: behaviouralReqs, category: 'behavioural' },
  ];

  for (const bucket of buckets) {
    if (bucket.reqs.length === 0) continue;
    const qs = await generateQuestionsForRequirements(bucket.reqs, bucket.category, research, onProgress, 'q_tmp_');
    questions.push(...qs);
  }

  // 5. Flashcards.
  const flashcards = await generateFlashcards(requirements, questions, onProgress);

  // 6. Coverage loop — deterministic check, targeted regeneration, until all
  //    must-have requirements are covered or passes are exhausted.
  await onProgress('coverage_pass', 'Checking requirement coverage …');
  let coverage = computeCoverage(questions, requirements);
  let pass = 1;

  while (pass <= MAX_COVERAGE_PASSES && coverage.uncovered.length > 0) {
    const uncoveredReqs = requirements.filter((r) => coverage.uncovered.includes(r.id));
    const mustUncovered = uncoveredReqs.filter((r) => r.priority === 'must');

    await onProgress(
      'coverage_pass',
      `Coverage pass ${pass}: ${coverage.uncovered.length} requirement(s) without questions` +
        (mustUncovered.length ? ` (${mustUncovered.length} must-have)` : '')
    );

    // Targeted generation only for the gaps, category derived from requirement kind.
    for (const req of uncoveredReqs) {
      const category =
        req.kind === 'technical' ? 'technical' : req.kind === 'behavioural' ? 'behavioural' : 'company-fit';
      try {
        const gapQs = await generateQuestionsForRequirements([req], category, research, onProgress, 'q_gap_');
        questions.push(...gapQs);
      } catch (err) {
        await onProgress('coverage_pass', `Gap-fill for ${req.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    coverage = computeCoverage(questions, requirements);
    if (coverage.uncovered.length === 0) break;
    pass += 1;
  }

  // Uncoverable requirements are recorded honestly.
  const stillUncovered = coverage.uncovered;
  const mustStillUncovered = stillUncovered.filter((id) =>
    requirements.find((r) => r.id === id && r.priority === 'must')
  );

  await onProgress(
    'building_schedule',
    mustStillUncovered.length
      ? `WARNING: ${mustStillUncovered.length} must-have requirement(s) could not be covered after ${pass} pass(es)`
      : 'All must-have requirements covered'
  );

  // 7. Schedule — deterministic.
  const schedule = buildSchedule(questions, requirements, days);

  await onProgress('finalizing', 'Assembling kit …');

  const kit: KitDocKit = {
    source: {
      company: hostToName(company_url),
      company_url,
      role: roleMeta.title || '',
      location: '',
      jd_chars: jd.length,
      researched_at: new Date().toISOString(),
      pages_used: research.pages.slice(0, 10).map((p) => p.url),
    },
    company_brief: { ...brief, meta: generatedState() },
    role: {
      title: roleMeta.title || '',
      seniority: roleMeta.seniority || '',
      responsibilities: roleMeta.responsibilities ?? [],
      requirements: requirements.map((r) => ({ ...r, meta: generatedState() })),
    },
    questions: questions.map((q) => ({ ...q, id: nextQuestionId(), meta: generatedState() })),
    flashcards: flashcards.map((f) => ({ ...f, meta: generatedState() })),
    schedule,
    coverage: { uncovered_requirement_ids: stillUncovered, passes: pass },
  };

  await onProgress('ready', 'Kit ready');
  return kit;
}

// Convenience wrapper used by routes and the evaluate script.
export async function generateKitDoc(
  userId: string,
  title: string,
  input: PipelineInput,
  batchId: string | null = null
): Promise<KitDoc> {
  const doc = await Kit.create({
    userId,
    title,
    status: 'generating',
    phase: 'queued',
    progress: [],
    days: input.days,
    batchId,
    kit: null,
  });

  void (async () => {
    try {
      const kit = await runPipeline(input, async (phase, message) => {
        await Kit.updateOne(
          { _id: doc._id },
          { $push: { progress: { phase, message, at: new Date().toISOString() } }, $set: { phase } }
        );
      });
      await Kit.updateOne({ _id: doc._id }, { $set: { kit, status: 'ready', phase: 'ready' } });
    } catch (err) {
      await Kit.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'failed',
            phase: 'failed',
            error: {
              code: err instanceof PipelineError ? err.code : 'GENERATION_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          },
        }
      );
    }
  })();

  return doc;
}
