import mongoose, { Schema } from 'mongoose';
import type {
  CompanyBrief,
  Coverage,
  Question,
  Flashcard,
  Requirement,
  Schedule,
  Source,
} from '../types/kit';
import type { Stateful } from '../types/state';

export type GenerationPhase =
  | 'queued'
  | 'researching_company'
  | 'searching_discussion'
  | 'extracting_requirements'
  | 'generating_questions'
  | 'generating_flashcards'
  | 'generating_brief'
  | 'coverage_pass'
  | 'building_schedule'
  | 'finalizing'
  | 'ready'
  | 'failed';

export interface JobProgressEntry {
  phase: GenerationPhase;
  message: string;
  at: string;
}

export interface KitDocKit {
  source: Source;
  company_brief: Stateful<CompanyBrief>;
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Stateful<Requirement>[];
  };
  questions: Stateful<Question>[];
  flashcards: Stateful<Flashcard>[];
  schedule: Schedule;
  coverage: Coverage;
}

export interface PracticeEntry {
  confidence: number;
  reviewedAt: string;
  reviews: number;
}

export interface KitDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  status: 'generating' | 'ready' | 'failed';
  phase: GenerationPhase;
  progress: JobProgressEntry[];
  error: { code: string; message: string } | null;
  days: number;
  batchId: string | null;
  practice: Map<string, PracticeEntry>;
  kit: KitDocKit | null;
  createdAt: Date;
  updatedAt: Date;
}

const StatefulMetaSchema = new Schema(
  {
    origin: { type: String, enum: ['generated', 'user_added'], default: 'generated' },
    edited: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
  },
  { _id: false }
);

const RequirementSchema = new Schema(
  {
    id: String,
    text: String,
    kind: { type: String, enum: ['technical', 'behavioural', 'domain'] },
    priority: { type: String, enum: ['must', 'nice'] },
  },
  { _id: false }
).add({ meta: StatefulMetaSchema });

const QuestionSchema = new Schema(
  {
    id: String,
    requirement_ids: [String],
    category: { type: String, enum: ['technical', 'behavioural', 'system-design', 'company-fit'] },
    prompt: String,
    answer_outline: String,
    difficulty: { type: Number, min: 1, max: 3 },
    meta: StatefulMetaSchema,
  },
  { _id: false }
);

const FlashcardSchema = new Schema(
  {
    id: String,
    front: String,
    back: String,
    requirement_ids: [String],
    meta: StatefulMetaSchema,
  },
  { _id: false }
);

const KitSchema = new Schema<KitDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating' },
    phase: { type: String, default: 'queued' },
    progress: [
      {
        phase: String,
        message: String,
        at: String,
      },
    ],
    error: { type: { code: String, message: String }, default: null },
    days: { type: Number, required: true, min: 1, max: 60 },
    batchId: { type: String, default: null, index: true },
    practice: {
      type: Map,
      of: new Schema(
        { confidence: Number, reviewedAt: String, reviews: { type: Number, default: 0 } },
        { _id: false }
      ),
      default: new Map(),
    },
    kit: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const Kit: mongoose.Model<KitDoc> =
  (mongoose.models.Kit as mongoose.Model<KitDoc>) ?? mongoose.model<KitDoc>('Kit', KitSchema);
