/**
 * Shared kit types mirroring the backend (Appendix A) including the explicit
 * per-item state metadata: origin (generated|user_added), edited, pinned.
 */
export type ItemMeta = {
  origin: 'generated' | 'user_added';
  edited: boolean;
  pinned: boolean;
};

export type Requirement = {
  id: string;
  text: string;
  kind: 'technical' | 'behavioural' | 'domain';
  priority: 'must' | 'nice';
  meta?: ItemMeta;
};

export type Question = {
  id: string;
  requirement_ids: string[];
  category: 'technical' | 'behavioural' | 'system-design' | 'company-fit';
  prompt: string;
  answer_outline: string;
  difficulty: number;
  meta?: ItemMeta;
};

export type Flashcard = {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  meta?: ItemMeta;
};

export type ScheduleDay = {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
};

export type Kit = {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: {
    summary: string;
    what_they_do: string;
    sources: string[];
    meta?: ItemMeta;
  };
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Requirement[];
  };
  questions: Question[];
  flashcards: Flashcard[];
  schedule: {
    days_available: number;
    days: ScheduleDay[];
  };
  coverage: {
    uncovered_requirement_ids: string[];
    passes: number;
  };
};

export type KitDocument = {
  _id: string;
  title: string;
  status: 'generating' | 'ready' | 'failed';
  phase: string;
  progress: Array<{ phase: string; message: string; at: string }>;
  error: { code: string; message: string } | null;
  days: number;
  batchId: string | null;
  kit: Kit | null;
  createdAt: string;
  updatedAt: string;
};

export const CATEGORY_LABELS: Record<Question['category'], string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System Design',
  'company-fit': 'Company Fit',
};
