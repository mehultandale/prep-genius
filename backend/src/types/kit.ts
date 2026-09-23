/**
 * Kit domain types — must match Appendix A of the brief exactly.
 * Zod schemas double as runtime validation for LLM output and API payloads.
 */
import { z } from 'zod';

export const RequirementKind = z.enum(['technical', 'behavioural', 'domain']);
export const Priority = z.enum(['must', 'nice']);
export const QuestionCategory = z.enum(['technical', 'behavioural', 'system-design', 'company-fit']);

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: RequirementKind,
  priority: Priority,
});

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
  category: QuestionCategory,
  prompt: z.string().min(1),
  answer_outline: z.string().default(''),
  difficulty: z.number().int().min(1).max(3).default(2),
});

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string()).default([]),
  minutes: z.number().int().min(1),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(1),
  days: z.array(ScheduleDaySchema),
});

export const SourceSchema = z.object({
  company: z.string().default(''),
  company_url: z.string().default(''),
  role: z.string().default(''),
  location: z.string().default(''),
  jd_chars: z.number().int().min(0),
  researched_at: z.string(),
  pages_used: z.array(z.string()).default([]),
});

export const CompanyBriefSchema = z.object({
  summary: z.string().default(''),
  what_they_do: z.string().default(''),
  sources: z.array(z.string()).default([]),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()).default([]),
  passes: z.number().int().min(0).default(0),
});

// Tolerant string (LLMs sometimes emit nulls for optional fields).
const string_or_empty = z.preprocess((v) => v ?? '', z.string());

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: z.object({
    title: string_or_empty,
    seniority: string_or_empty,
    responsibilities: z.array(z.string()).default([]),
    requirements: z.array(RequirementSchema).default([]),
  }),
  questions: z.array(QuestionSchema).default([]),
  flashcards: z.array(FlashcardSchema).default([]),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type Kit = z.infer<typeof KitSchema>;
