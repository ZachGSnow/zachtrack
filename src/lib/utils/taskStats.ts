// Finding tasks and looking back at what got done (ARCHITECTURE.md 3.66):
// search, the Done page, and the task numbers in the weekly review, Insights
// and Year in review. Pure; tests/taskStats.test.ts.

import type { Task, TaskCompletion, TaskProject } from '../db';
import { dayKey, taskContext } from './tasks';

export interface SearchHit {
  task: Task;
  /** Where it lives ("House / Now"). */
  context: string;
  /** A piece of the notes around the first word found there, when the name alone didn't have them all. */
  snippet?: string;
}

/**
 * Tasks and subtasks whose name or notes contain every word of `query`
 * (any case, any order); open ones first by due date, then completed ones,
 * most recent first. Archived projects are searched too: that's often why
 * you search.
 */
export function searchTasks(tasks: readonly Task[], projects: readonly TaskProject[], query: string, limit = 100): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const t of tasks) {
    const name = t.name.toLowerCase();
    const notes = (t.notes ?? '').toLowerCase();
    if (!words.every((w) => name.includes(w) || notes.includes(w))) continue;
    const inNotes = words.find((w) => !name.includes(w) && notes.includes(w)) ?? (words.every((w) => name.includes(w)) ? undefined : words[0]);
    let snippet: string | undefined;
    if (inNotes && t.notes) {
      const at = notes.indexOf(inNotes);
      const start = Math.max(0, at - 30);
      const end = Math.min(t.notes.length, at + inNotes.length + 50);
      snippet = `${start > 0 ? '...' : ''}${t.notes.slice(start, end).replace(/\s+/g, ' ').trim()}${end < t.notes.length ? '...' : ''}`;
    }
    hits.push({ task: t, context: taskContext(t, tasks, projects), ...(snippet ? { snippet } : {}) });
  }
  hits.sort((a, b) => {
    const da = a.task.completedAt ?? 0;
    const db = b.task.completedAt ?? 0;
    if (!da !== !db) return da ? 1 : -1;
    if (da && db) return db - da;
    return (a.task.dueOn ?? '9999').localeCompare(b.task.dueOn ?? '9999') || a.task.name.localeCompare(b.task.name);
  });
  return hits.slice(0, limit);
}

export interface DoneItem {
  key: string;
  /** The task to open. */
  taskId: string;
  name: string;
  context: string;
  at: number;
  /** A completion of a repeating task (the task itself moved on), or a task closed for good. */
  kind: 'closed' | 'repeat';
  /** For a repeating task: how it went against its due date. */
  timing?: 'on time' | 'late' | 'early';
}

export interface DoneDay {
  day: string;
  items: DoneItem[];
}

/** Everything done at or after `since`: tasks and subtasks closed, and each completion of a repeating task, by day, newest first. */
export function doneSince(tasks: readonly Task[], completions: readonly TaskCompletion[], projects: readonly TaskProject[], since: number): DoneDay[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const items: DoneItem[] = [];
  for (const t of tasks) {
    if (!t.completedAt || t.completedAt < since) continue;
    items.push({ key: t.id, taskId: t.id, name: t.name, context: taskContext(t, tasks, projects), at: t.completedAt, kind: 'closed' });
  }
  for (const c of completions) {
    if (c.completedAt < since) continue;
    const t = byId.get(c.taskId);
    if (!t) continue;
    items.push({ key: c.id, taskId: t.id, name: t.name, context: taskContext(t, tasks, projects), at: c.completedAt, kind: 'repeat', ...(c.dueOn ? { timing: timingOf(c.dueOn, c.completedAt) } : {}) });
  }
  items.sort((a, b) => b.at - a.at);
  const days: DoneDay[] = [];
  for (const item of items) {
    const day = dayKey(item.at);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

function timingOf(dueOn: string, completedAt: number): 'on time' | 'late' | 'early' {
  const done = dayKey(completedAt);
  return done === dueOn ? 'on time' : done > dueOn ? 'late' : 'early';
}

export interface TaskTally {
  /** Tasks and subtasks closed, plus completions of repeating tasks. */
  done: number;
  /** Completions of repeating tasks, and how many of them were by their due date. */
  repeats: number;
  repeatsOnTime: number;
}

/** What got done in [from, to): for the weekly review, Insights and Year in review. */
export function tallyTasks(tasks: readonly Task[], completions: readonly TaskCompletion[], from: number, to: number): TaskTally {
  const closed = tasks.filter((t) => t.completedAt != null && t.completedAt >= from && t.completedAt < to).length;
  const reps = completions.filter((c) => c.completedAt >= from && c.completedAt < to);
  const onTime = reps.filter((c) => !c.dueOn || dayKey(c.completedAt) <= c.dueOn).length;
  return { done: closed + reps.length, repeats: reps.length, repeatsOnTime: onTime };
}
