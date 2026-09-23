'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, kits } from '@/lib/api';
import type { Flashcard, ItemMeta, Kit, KitDocument, Question } from '@/types/kit';
import { CATEGORY_LABELS } from '@/types/kit';
import { PinnedBanner, StateTags } from '@/components/StateTags';

type Tab = 'overview' | 'questions' | 'flashcards' | 'schedule' | 'practice';

export default function KitPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [doc, setDoc] = useState<KitDocument | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await kits.get(id);
      setDoc(res.kit);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load kit');
    }
  }, [id]);

  // Poll while generating.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      await refresh();
      if (!cancelled) timer = setTimeout(poll, 2500);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">← Back to kits</Link>
      </main>
    );
  }

  if (!doc) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-slate-500">Loading…</main>;
  }

  if (doc.status === 'failed') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-xl font-bold text-red-700">Generation failed</h1>
        <p className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>{doc.error?.code}</strong> — {doc.error?.message}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">← Back to kits</Link>
      </main>
    );
  }

  if (doc.status === 'generating' || !doc.kit) {
    return <ProgressView doc={doc} />;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← All kits</Link>
        <h1 className="mt-1 text-2xl font-bold">{doc.kit.source.company} — {doc.kit.role.title || doc.title}</h1>
        <p className="text-sm text-slate-500">
          {doc.kit.source.company_url} · researched {new Date(doc.kit.source.researched_at).toLocaleString()}
        </p>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {(['overview', 'questions', 'flashcards', 'schedule', 'practice'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab kit={doc.kit} refresh={refresh} />}
      {tab === 'questions' && <QuestionsTab kit={doc.kit} refresh={refresh} />}
      {tab === 'flashcards' && <FlashcardsTab kit={doc.kit} refresh={refresh} />}
      {tab === 'schedule' && <ScheduleTab kit={doc.kit} refresh={refresh} />}
      {tab === 'practice' && <PracticeTab kit={doc.kit} refresh={refresh} />}
    </main>
  );
}

// ── Progress view ─────────────────────────────────────────────────────────────
function ProgressView({ doc }: { doc: KitDocument }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-xl font-bold">Generating your kit…</h1>
      <p className="mt-1 text-sm text-slate-500">
        Research, question generation and coverage passes take a few minutes. This page updates live.
      </p>
      <ol className="mt-6 space-y-2">
        {doc.progress.map((p, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
              {p.phase.replace(/_/g, ' ')}
            </span>
            {p.message}
            <span className="ml-2 text-xs text-slate-400">{new Date(p.at).toLocaleTimeString()}</span>
          </li>
        ))}
      </ol>
      {doc.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>{doc.error.code}</strong> — {doc.error.message}
        </p>
      )}
    </main>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────
type TabProps = { kit: Kit; refresh: () => Promise<void> };

function useKitAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function InlineText({
  value,
  onSave,
  multiline = false,
  className = '',
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-text hover:bg-indigo-50 ${className}`}
        title="Click to edit"
      >
        {value || <em className="text-slate-400">(empty — click to add)</em>}
      </span>
    );
  }

  const commit = async () => {
    setEditing(false);
    if (draft !== value) await onSave(draft);
  };

  return multiline ? (
    <textarea
      autoFocus
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="w-full rounded border border-indigo-300 p-1 text-sm"
    />
  ) : (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-full rounded border border-indigo-300 px-1 py-0.5 text-sm"
    />
  );
}

function PinButton({ meta, onToggle }: { meta?: ItemMeta; onToggle: () => Promise<void> }) {
  if (!meta) return null;
  return (
    <button
      onClick={onToggle}
      title={meta.pinned ? 'Unpin (exposed to regeneration)' : 'Pin (kept on top, protected from regeneration)'}
      className={`rounded px-1.5 py-0.5 text-xs ${
        meta.pinned ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      {meta.pinned ? '📌 Pinned' : 'Pin'}
    </button>
  );
}

function RegenerateButton({ section, run }: { section: string; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  return (
    <button
      onClick={() => run(() => api.post(`/api/kits/${window.location.pathname.split('/')[2]}/regenerate/${section}`))}
      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
      title="Regenerate just this section — pinned and hand-added items are preserved, other sections untouched"
    >
      ↻ Regenerate {section.replace('_', ' ')}
    </button>
  );
}

function kitId(): string {
  return window.location.pathname.split('/')[2];
}

// ── Overview tab: brief + requirements ────────────────────────────────────────
function OverviewTab({ kit, refresh }: TabProps) {
  const { busy, error, run } = useKitAction(refresh);
  const brief = kit.company_brief;
  const pinnedReqs = kit.role.requirements.filter((r) => r.meta?.pinned);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Company brief</h2>
            <StateTags meta={brief.meta} />
          </div>
          <RegenerateButton section="company_brief" run={run} />
        </div>
        <p className="mb-2 text-sm text-slate-700">
          <InlineText
            multiline
            value={brief.summary}
            onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/company-brief`, { summary: v, what_they_do: brief.what_they_do }))}
          />
        </p>
        <p className="text-sm text-slate-600">
          <strong>What they do: </strong>
          <InlineText
            multiline
            value={brief.what_they_do}
            onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/company-brief`, { summary: brief.summary, what_they_do: v }))}
          />
        </p>
        {brief.sources?.length > 0 && (
          <p className="mt-3 text-xs text-slate-400">Sources: {brief.sources.join(', ')}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Role breakdown</h2>
          <RegenerateButton section="questions" run={run} />
        </div>
        <p className="mb-1 text-sm">
          <strong>Title: </strong>
          <InlineText
            value={kit.role.title}
            onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/role-meta`, { title: v, seniority: kit.role.seniority }))}
          />
        </p>
        <p className="mb-3 text-sm">
          <strong>Seniority: </strong>
          <InlineText
            value={kit.role.seniority}
            onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/role-meta`, { title: kit.role.title, seniority: v }))}
          />
        </p>

        <PinnedBanner count={pinnedReqs.length} label="requirements" />
        <h3 className="mb-2 text-sm font-semibold">Requirements</h3>
        <ul className="space-y-2">
          {[...kit.role.requirements]
            .sort((a, b) => Number(b.meta?.pinned ?? false) - Number(a.meta?.pinned ?? false))
            .map((r) => (
              <li key={r.id} className={`rounded-lg border px-3 py-2 text-sm ${r.meta?.pinned ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-slate-400">{r.id}</span>
                  <span className="flex items-center gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${r.priority === 'must' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.priority}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{r.kind}</span>
                    <StateTags meta={r.meta} />
                    <PinButton
                      meta={r.meta}
                      onToggle={() =>
                        run(() =>
                          api.patch(`/api/kits/${kitId()}/requirements/${r.id}`, {
                            text: r.text,
                            priority: r.priority,
                            pinned: !r.meta?.pinned,
                          })
                        )
                      }
                    />
                  </span>
                </div>
                <InlineText
                  value={r.text}
                  onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/requirements/${r.id}`, { text: v, priority: r.priority }))}
                />
              </li>
            ))}
        </ul>

        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Coverage: {kit.role.requirements.length - kit.coverage.uncovered_requirement_ids.length}/{kit.role.requirements.length} requirements covered
          · {kit.coverage.passes} coverage pass(es)
          {kit.coverage.uncovered_requirement_ids.length > 0 && (
            <span className="text-red-600"> · uncovered: {kit.coverage.uncovered_requirement_ids.join(', ')}</span>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Questions tab ─────────────────────────────────────────────────────────────
function QuestionsTab({ kit, refresh }: TabProps) {
  const { busy, error, run } = useKitAction(refresh);
  const [newPrompt, setNewPrompt] = useState('');
  const [newCategory, setNewCategory] = useState<Question['category']>('technical');
  const categories = Object.keys(CATEGORY_LABELS) as Question['category'][];

  const grouped = useMemo(() => {
    const map = new Map<Question['category'], Question[]>();
    for (const q of kit.questions) {
      const list = map.get(q.category) ?? [];
      list.push(q);
      map.set(q.category, list);
    }
    // Pinned first within each category.
    for (const [cat, list] of map) {
      map.set(
        cat,
        [...list].sort((a, b) => Number(b.meta?.pinned ?? false) - Number(a.meta?.pinned ?? false))
      );
    }
    return map;
  }, [kit.questions]);

  const pinnedCount = kit.questions.filter((q) => q.meta?.pinned).length;

  return (
    <div className="space-y-6">
      <PinnedBanner count={pinnedCount} label="questions" />

      <div className="flex justify-end">
        <RegenerateButton section="questions" run={run} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newPrompt.trim()) return;
          run(async () => {
            await api.post(`/api/kits/${kitId()}/questions`, { prompt: newPrompt, category: newCategory });
            setNewPrompt('');
          });
        }}
        className="flex gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <input
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="Add your own question…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as Question['category'])}
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          Add
        </button>
      </form>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {categories.map((cat) => {
        const list = grouped.get(cat) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={cat} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold">{CATEGORY_LABELS[cat]} <span className="text-sm font-normal text-slate-400">({list.length})</span></h2>
            <ul className="space-y-3">
              {list.map((q) => (
                <li key={q.id} className={`rounded-lg border p-3 ${q.meta?.pinned ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-slate-400">{q.id}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">D{q.difficulty}</span>
                      <StateTags meta={q.meta} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <select
                        value={q.category}
                        onChange={(e) => run(() => api.post(`/api/kits/${kitId()}/questions/${q.id}/move`, { category: e.target.value }))}
                        className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                        title="Move to another category"
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                        ))}
                      </select>
                      <PinButton
                        meta={q.meta}
                        onToggle={() => run(() => api.patch(`/api/kits/${kitId()}/questions/${q.id}`, { pinned: !q.meta?.pinned }))}
                      />
                      <button
                        onClick={() => run(() => api.delete(`/api/kits/${kitId()}/questions/${q.id}`))}
                        className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  <InlineText
                    value={q.prompt}
                    onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/questions/${q.id}`, { prompt: v }))}
                    className="font-medium"
                  />
                  <div className="mt-1 text-sm text-slate-600">
                    <strong className="text-xs uppercase text-slate-400">Outline: </strong>
                    <InlineText
                      multiline
                      value={q.answer_outline}
                      onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/questions/${q.id}`, { answer_outline: v }))}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">covers: {q.requirement_ids.join(', ') || '—'}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ── Flashcards tab ────────────────────────────────────────────────────────────
function FlashcardsTab({ kit, refresh }: TabProps) {
  const { busy, error, run } = useKitAction(refresh);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const pinnedCount = kit.flashcards.filter((f) => f.meta?.pinned).length;

  const ordered = [...kit.flashcards].sort(
    (a, b) => Number(b.meta?.pinned ?? false) - Number(a.meta?.pinned ?? false)
  );

  return (
    <div className="space-y-6">
      <PinnedBanner count={pinnedCount} label="flashcards" />
      <div className="flex justify-end">
        <RegenerateButton section="flashcards" run={run} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!front.trim() || !back.trim()) return;
          run(async () => {
            await api.post(`/api/kits/${kitId()}/flashcards`, { front, back });
            setFront('');
            setBack('');
          });
        }}
        className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2"
      >
        <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front…" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back…" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 md:col-span-2">
          Add flashcard
        </button>
      </form>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="grid gap-3 md:grid-cols-2">
        {ordered.map((f) => (
          <li key={f.id} className={`rounded-xl border p-4 ${f.meta?.pinned ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <div className="mb-2 flex items-center justify-between">
              <StateTags meta={f.meta} />
              <span className="flex items-center gap-1.5">
                <PinButton
                  meta={f.meta}
                  onToggle={() => run(() => api.patch(`/api/kits/${kitId()}/flashcards/${f.id}`, { pinned: !f.meta?.pinned }))}
                />
                <button
                  onClick={() => run(() => api.delete(`/api/kits/${kitId()}/flashcards/${f.id}`))}
                  className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </span>
            </div>
            <p className="text-sm font-medium">
              <InlineText value={f.front} onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/flashcards/${f.id}`, { front: v }))} />
            </p>
            <p className="mt-1 text-sm text-slate-600">
              <InlineText multiline value={f.back} onSave={(v) => run(() => api.patch(`/api/kits/${kitId()}/flashcards/${f.id}`, { back: v }))} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────────
function ScheduleTab({ kit, refresh }: TabProps) {
  const { run } = useKitAction(refresh);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {kit.schedule.days_available}-day plan
        </h2>
        <RegenerateButton section="schedule" run={run} />
      </div>
      <ol className="space-y-3">
        {kit.schedule.days.map((d) => (
          <li key={d.day} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Day {d.day}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{d.minutes} min</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{d.focus}</p>
            <p className="mt-1 text-xs text-slate-400">{d.question_ids.length} question(s): {d.question_ids.join(', ') || '—'}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Practice tab ──────────────────────────────────────────────────────────────
type PracticeRecord = Record<string, { confidence: number; reviewedAt: string; reviews: number }>;

function PracticeTab({ kit, refresh }: TabProps) {
  const { run } = useKitAction(refresh);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [records, setRecords] = useState<PracticeRecord>({});

  useEffect(() => {
    // Load practice records embedded in the doc (if present).
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/kits/${kitId()}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('pg_token') ?? ''}` },
    })
      .then((r) => r.json())
      .then((res) => {
        const map: PracticeRecord = {};
        for (const [k, v] of Object.entries(res?.kit?.practice ?? {})) {
          map[k] = v as PracticeRecord[string];
        }
        setRecords(map);
      })
      .catch(() => {});
  }, []);

  // Confidence-weighted ordering: least confident first, unseen after that.
  const ordered = useMemo(() => {
    const conf = (f: Flashcard) => records[f.id]?.confidence ?? 0; // unseen = 0
    return [...kit.flashcards].sort((a, b) => conf(a) - conf(b));
  }, [kit.flashcards, records]);

  const card = ordered[index];

  if (!card) {
    return <p className="text-sm text-slate-500">No flashcards to practise yet.</p>;
  }

  const covered = kit.flashcards.filter((f) => records[f.id]).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
          <span>Card {index + 1} of {ordered.length}</span>
          <span>Covered {covered}/{kit.flashcards.length}</span>
        </div>
        <div className="progress-bar mb-4 h-1.5 rounded bg-slate-100">
          <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${(covered / Math.max(kit.flashcards.length, 1)) * 100}%` }} />
        </div>

        <p className="mb-4 text-lg font-medium">{card.front}</p>

        {revealed ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{card.back}</p>
        ) : (
          <button
            onClick={() => setRevealed(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Reveal answer
          </button>
        )}

        {revealed && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">How confident were you?</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    run(async () => {
                      await api.post(`/api/kits/${kitId()}/practice`, {
                        results: [{ flashcard_id: card.id, confidence: c }],
                      });
                      setRecords((prev) => ({
                        ...prev,
                        [card.id]: { confidence: c, reviewedAt: new Date().toISOString(), reviews: (prev[card.id]?.reviews ?? 0) + 1 },
                      }));
                      setRevealed(false);
                      setIndex((i) => Math.min(i + 1, ordered.length - 1));
                    })
                  }
                  className={`h-9 w-9 rounded-full text-sm font-semibold ${
                    c <= 2 ? 'bg-red-100 text-red-700 hover:bg-red-200' : c === 3 ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">1 = lost, 5 = nailed it. Least-confident cards come back first next session.</p>
          </div>
        )}
      </div>
    </div>
  );
}
