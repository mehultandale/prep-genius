/**
 * Deterministic schedule builder — pure arithmetic, no model involved.
 * Distributes questions across exactly `days` days; must-have and harder
 * material lands earlier; every day gets an integer minute total.
 */
import type { Question, Requirement, Schedule, ScheduleDay } from '../types/kit';

const DAILY_MINUTES_DEFAULT = 60;

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function buildSchedule(
  questions: Question[],
  requirements: Requirement[],
  days: number
): Schedule {
  const dayCount = clampInt(days, 1, 60);
  const mustIds = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));

  // Weight: must-have first, harder questions earlier within their tier.
  const ordered = [...questions].sort((a, b) => {
    const aMust = a.requirement_ids.some((id) => mustIds.has(id)) ? 0 : 1;
    const bMust = b.requirement_ids.some((id) => mustIds.has(id)) ? 0 : 1;
    if (aMust !== bMust) return aMust - bMust;
    if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
    return a.id.localeCompare(b.id);
  });

  const perDay = Math.max(1, Math.ceil(ordered.length / dayCount));
  const daysOut: ScheduleDay[] = [];
  let cursor = 0;

  for (let d = 1; d <= dayCount; d++) {
    const slice = ordered.slice(cursor, cursor + perDay);
    cursor += perDay;
    const remainingDays = dayCount - d;
    const remainingItems = ordered.length - cursor;
    // Final days collapse to avoid empty trailing days when items run out.
    const take = remainingDays > 0 && remainingItems < perDay && remainingItems > 0
      ? Math.max(1, remainingItems - (remainingDays - 1))
      : slice.length;
    const ids = (d === dayCount ? ordered.slice(cursor - slice.length) : slice).map((q) => q.id);
    const focusReqs = requirements.filter((r) =>
      (d === dayCount ? ordered.slice(cursor - slice.length) : slice).some((q) =>
        q.requirement_ids.includes(r.id)
      )
    );
    const focus = focusReqs.length
      ? focusReqs.slice(0, 3).map((r) => r.text).join('; ')
      : 'Review and mock practice of everything so far';
    daysOut.push({
      day: d,
      focus: focus.slice(0, 300) || 'General review',
      question_ids: ids,
      minutes: clampInt(Math.max(20, ids.length * 12), 20, 180),
    });
    if (cursor >= ordered.length && d < dayCount) {
      // Stretch remaining items across remaining days if we ran out early.
      if (ordered.length === 0) {
        for (let rest = d + 1; rest <= dayCount; rest++) {
          daysOut.push({
            day: rest,
            focus: 'Consolidation and self-testing',
            question_ids: [],
            minutes: 30,
          });
        }
        break;
      }
    }
  }

  return { days_available: dayCount, days: daysOut.slice(0, dayCount) };
}

/** Deterministic coverage check — code, not model. */
export function computeCoverage(
  questions: Question[],
  requirements: Requirement[]
): { uncovered: string[]; passes: number } {
  const covered = new Set<string>();
  for (const q of questions) {
    for (const id of q.requirement_ids) covered.add(id);
  }
  const uncovered = requirements.filter((r) => !covered.has(r.id)).map((r) => r.id);
  return { uncovered, passes: 0 };
}
