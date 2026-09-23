import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Kit } from '../models/Kit';
import type { KitDoc, KitDocKit } from '../models/Kit';
import { Batch } from '../models/Batch';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errors';
import { generateKitDoc, researchCompany, extractRequirements, generateQuestionsForRequirements, generateFlashcards, draftBriefAndRole } from '../services/pipeline';
import { buildSchedule, computeCoverage } from '../services/schedule';
import { markEdited, userAddedState, generatedState, isUserOwned, type Stateful } from '../types/state';
import type { Question, Flashcard } from '../types/kit';

const router = Router();
router.use(requireAuth);

// ── Create (single) ───────────────────────────────────────────────────────────
const CreateSchema = z.object({
  jd: z.string().min(20, 'Job description looks too short'),
  company_url: z.string().url('Company website must be a valid URL'),
  days: z.number().int().min(1).max(60),
  title: z.string().optional(),
});

router.post('/', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
  const { jd, company_url, days, title } = parsed.data;
  const kit = await generateKitDoc(
    req.userId!,
    title ?? `${hostLabel(company_url)} — ${new Date().toLocaleDateString()}`,
    { jd, company_url, days }
  );
  res.status(202).json({ id: String(kit._id), status: kit.status });
}));

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'kit';
  }
}

// ── Batch create (file of description-and-company pairs) ─────────────────────
const BatchSchema = z.object({
  cases: z.array(z.object({
    id: z.string().optional(),
    jd: z.string().min(20),
    company_url: z.string().url(),
    days: z.number().int().min(1).max(60),
  })).min(1).max(50),
});

router.post('/batch', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = BatchSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input');
  const { cases } = parsed.data;
  const batch = await Batch.create({ userId: req.userId!, total: cases.length });
  const created = [];
  for (const c of cases) {
    const kit = await generateKitDoc(
      req.userId!,
      `${hostLabel(c.company_url)} (${c.id ?? 'case'})`,
      { jd: c.jd, company_url: c.company_url, days: c.days },
      String(batch._id)
    );
    created.push({ id: c.id ?? String(kit._id), kitId: String(kit._id) });
  }
  res.status(202).json({ batchId: String(batch._id), kits: created });
}));

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const kits = await Kit.find({ userId: req.userId! })
    .sort({ createdAt: -1 })
    .select('title status phase error days createdAt updatedAt batchId kit.source.role kit.role.title');
  res.json({ kits });
}));

// ── Get one ───────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found');
  res.json({ kit });
}));

// ── Progress polling ──────────────────────────────────────────────────────────
router.get('/:id/progress', asyncHandler(async (req: AuthedRequest, res) => {
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! })
    .select('status phase progress error');
  if (!kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found');
  res.json({ status: kit.status, phase: kit.phase, progress: kit.progress, error: kit.error });
}));

// ── Company brief ─────────────────────────────────────────────────────────────
router.patch('/:id/company-brief', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ summary: z.string(), what_they_do: z.string() }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid brief payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  kit.kit.company_brief = markEdited(kit.kit.company_brief, parsed.data);
  await kit.save();
  res.json({ kit });
}));

// ── Role metadata ─────────────────────────────────────────────────────────────
router.patch('/:id/role-meta', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ title: z.string(), seniority: z.string() }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid role payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  kit.kit.role = { ...kit.kit.role, ...parsed.data };
  await kit.save();
  res.json({ kit });
}));

// ── Requirements ──────────────────────────────────────────────────────────────
router.patch('/:id/requirements/:rid', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ text: z.string().min(1), priority: z.enum(['must', 'nice']).optional() }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid requirement payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const reqItem = kit.kit.role.requirements.find((r) => r.id === req.params.rid);
  if (!reqItem) throw new AppError(404, 'NOT_FOUND', 'Requirement not found');
  Object.assign(reqItem, markEdited(reqItem, parsed.data));
  await kit.save();
  res.json({ kit });
}));

// ── Questions: add / edit / delete / move / reorder ───────────────────────────
const QuestionPatch = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().optional(),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  pinned: z.boolean().optional(),
});

router.post('/:id/questions', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = QuestionPatch.extend({ requirement_ids: z.array(z.string()).default([]) }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid question payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const q: Stateful<Question> = {
    id: `q_user_${Date.now().toString(36)}`,
    requirement_ids: parsed.data.requirement_ids,
    category: parsed.data.category ?? 'technical',
    prompt: parsed.data.prompt ?? 'Untitled question',
    answer_outline: parsed.data.answer_outline ?? '',
    difficulty: parsed.data.difficulty ?? 2,
    meta: userAddedState(),
  };
  kit.kit.questions.push(q);
  await kit.save();
  res.status(201).json({ kit });
}));

router.patch('/:id/questions/:qid', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = QuestionPatch.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid question payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const q = kit.kit.questions.find((x) => x.id === req.params.qid);
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
  Object.assign(q, markEdited(q, parsed.data));
  await kit.save();
  res.json({ kit });
}));

router.delete('/:id/questions/:qid', asyncHandler(async (req: AuthedRequest, res) => {
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  kit.kit.questions = kit.kit.questions.filter((x) => x.id !== req.params.qid);
  await kit.save();
  res.json({ kit });
}));

router.post('/:id/questions/:qid/move', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']) }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid category');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const q = kit.kit.questions.find((x) => x.id === req.params.qid);
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
  Object.assign(q, markEdited(q, { category: parsed.data.category }));
  await kit.save();
  res.json({ kit });
}));

router.post('/:id/questions/reorder', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ order: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid order payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const byId = new Map(kit.kit.questions.map((q) => [q.id, q]));
  const ordered = parsed.data.order.map((qid) => byId.get(qid)).filter(Boolean) as KitDocKit['questions'];
  const missing = kit.kit.questions.filter((q) => !parsed.data.order.includes(q.id));
  kit.kit.questions = [...ordered, ...missing];
  await kit.save();
  res.json({ kit });
}));

// ── Flashcards: add / edit / delete ───────────────────────────────────────────
const FlashcardPatch = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
});

router.post('/:id/flashcards', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = FlashcardPatch.extend({ requirement_ids: z.array(z.string()).default([]) }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid flashcard payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const f: Stateful<Flashcard> = {
    id: `f_user_${Date.now().toString(36)}`,
    front: parsed.data.front ?? '',
    back: parsed.data.back ?? '',
    requirement_ids: parsed.data.requirement_ids,
    meta: userAddedState(),
  };
  kit.kit.flashcards.push(f);
  await kit.save();
  res.status(201).json({ kit });
}));

router.patch('/:id/flashcards/:fid', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = FlashcardPatch.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid flashcard payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  const f = kit.kit.flashcards.find((x) => x.id === req.params.fid);
  if (!f) throw new AppError(404, 'NOT_FOUND', 'Flashcard not found');
  Object.assign(f, markEdited(f, parsed.data));
  await kit.save();
  res.json({ kit });
}));

router.delete('/:id/flashcards/:fid', asyncHandler(async (req: AuthedRequest, res) => {
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');
  kit.kit.flashcards = kit.kit.flashcards.filter((x) => x.id !== req.params.fid);
  await kit.save();
  res.json({ kit });
}));

// ── Section regeneration ──────────────────────────────────────────────────────
// Regenerating a section preserves user-owned items (pinned / user_added) and
// never touches other sections.
router.post('/:id/regenerate/:section', asyncHandler(async (req: AuthedRequest, res) => {
  const section = req.params.section;
  const allowed = ['company_brief', 'questions', 'flashcards', 'schedule'] as const;
  type Section = typeof allowed[number];
  if (!allowed.includes(section as Section)) throw new AppError(400, 'VALIDATION', 'Unknown section');

  const kitDoc = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kitDoc) throw new AppError(404, 'NOT_FOUND', 'Kit not found');
  if (!kitDoc.kit) throw new AppError(409, 'NOT_READY', 'Kit is still generating');

  const days = kitDoc.days;

  if (section === 'company_brief') {
    const research = await researchCompany(kitDoc.kit.source.company_url, () => {});
    const { brief } = await draftBriefAndRole(kitDoc.kit.source.role || kitDoc.title, research, () => {});
    // Preserve user edits: keep summary if user edited it.
    const prev = kitDoc.kit.company_brief;
    kitDoc.kit.company_brief = {
      ...brief,
      meta: generatedState(),
      ...(prev.meta?.edited ? { summary: prev.summary, what_they_do: prev.what_they_do } : {}),
    } as KitDocKit['company_brief'];
  } else if (section === 'questions') {
    const requirements = kitDoc.kit.role.requirements;
    const research = await researchCompany(kitDoc.kit.source.company_url, () => {});
    const fresh: KitDocKit['questions'] = [];
    const buckets: Array<{ reqs: typeof requirements; category: 'technical' | 'behavioural' | 'system-design' | 'company-fit' }> = [
      { reqs: requirements.filter((r) => r.kind === 'technical'), category: 'technical' },
      { reqs: requirements.filter((r) => r.kind === 'domain'), category: 'company-fit' },
      { reqs: requirements.filter((r) => r.kind === 'domain'), category: 'system-design' },
      { reqs: requirements.filter((r) => r.kind === 'behavioural'), category: 'behavioural' },
    ];
    for (const bucket of buckets) {
      if (!bucket.reqs.length) continue;
      const qs = await generateQuestionsForRequirements(bucket.reqs, bucket.category, research, () => {}, 'qr_');
      fresh.push(...qs.map((q) => ({ ...q, id: `q_re_${Date.now().toString(36)}_${q.id}`, meta: generatedState('generated') })));
    }
    // Keep user-owned (pinned or hand-added) questions only.
    const preserved = kitDoc.kit.questions.filter((q) => q.meta && isUserOwned(q.meta));
    kitDoc.kit.questions = [...preserved, ...fresh];
    const coverage = computeCoverage(
      kitDoc.kit.questions,
      kitDoc.kit.role.requirements
    );
    kitDoc.kit.coverage = { uncovered_requirement_ids: coverage.uncovered, passes: kitDoc.kit.coverage.passes + 1 };
  } else if (section === 'flashcards') {
    const research = await researchCompany(kitDoc.kit.source.company_url, () => {});
    const fresh = await generateFlashcards(kitDoc.kit.role.requirements, kitDoc.kit.questions, () => {});
    const preserved = kitDoc.kit.flashcards.filter((f) => f.meta && isUserOwned(f.meta));
    kitDoc.kit.flashcards = [
      ...preserved,
      ...fresh.map((f) => ({ ...f, id: `f_re_${Date.now().toString(36)}_${f.id}`, meta: generatedState('generated') })),
    ];
  } else if (section === 'schedule') {
    kitDoc.kit.schedule = buildSchedule(kitDoc.kit.questions, kitDoc.kit.role.requirements, days);
  }

  await kitDoc.save();
  res.json({ kit: kitDoc });
}));

// ── Practice: flashcard confidence ────────────────────────────────────────────
const PracticeSchema = z.object({
  results: z.array(z.object({
    flashcard_id: z.string(),
    confidence: z.number().int().min(1).max(5),
  })),
});

router.post('/:id/practice', asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = PracticeSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION', 'Invalid practice payload');
  const kit = await Kit.findOne({ _id: req.params.id, userId: req.userId! });
  if (!kit?.kit) throw new AppError(404, 'NOT_FOUND', 'Kit not found or not ready');

  for (const r of parsed.data.results) {
    const card = kit.kit.flashcards.find((f) => f.id === r.flashcard_id);
    if (!card) continue;
    kit.practice = kit.practice ?? new Map<string, { confidence: number; reviewedAt: string; reviews: number }>();
    const prev = kit.practice.get(r.flashcard_id);
    kit.practice.set(r.flashcard_id, {
      confidence: r.confidence,
      reviewedAt: new Date().toISOString(),
      reviews: (prev?.reviews ?? 0) + 1,
    });
  }
  await kit.save();
  res.json({ ok: true });
}));

export default router;
