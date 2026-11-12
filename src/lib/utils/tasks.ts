// What the Tasks screens show (ARCHITECTURE.md 3.60): a project's tasks
// grouped by section, subtasks under their task, due dates in words, and the
// numbers on a project's card. Pure; tests/tasksView.test.ts.

import type { Task, TaskProject, TaskSection } from '../db';
import { addDaysKey, dayStart, daysFrom, weekdayOf } from './dayKey';

export { dayKey, dayStart, daysFrom } from './dayKey';

/** The pseudo-project of tasks with no project, at /tasks/inbox. */
export const INBOX_ID = 'inbox';

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export interface DueText {
  text: string;
  state: DueState;
}

/** "Today", "Tomorrow", "Yesterday", "Fri", "Nov 30" or "Nov 30, 2027", with a time when set. */
export function describeDue(dueOn: string, dueTime: string | undefined, today: string): DueText {
  const days = daysFrom(today, dueOn);
  const date = new Date(dayStart(dueOn));
  let text: string;
  if (days === 0) text = 'Today';
  else if (days === 1) text = 'Tomorrow';
  else if (days === -1) text = 'Yesterday';
  else if (days > 1 && days < 7) text = date.toLocaleDateString(undefined, { weekday: 'short' });
  else if (date.getFullYear() === new Date(dayStart(today)).getFullYear()) text = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  else text = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (dueTime) {
    const [h, m] = dueTime.split(':').map(Number);
    text += `, ${new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  const state: DueState = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later';
  return { text, state };
}

const byOrder = (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;

/** A project's own top-level tasks (or the inbox's: no project and no parent). */
export function topLevelTasks(tasks: readonly Task[], projectId: string): Task[] {
  return tasks.filter((t) => !t.parentId && (projectId === INBOX_ID ? !t.projectId : t.projectId === projectId));
}

export interface SectionGroup {
  /** null: the tasks above the first section (no section, or one that was removed). */
  section: TaskSection | null;
  open: Task[];
  done: Task[];
}

/**
 * A project's top-level tasks by section, in the project's section order, each
 * in its own order. The group without a section comes first and only when it
 * has tasks; every real section is listed, empty or not, so tasks can be added
 * to it. Completed tasks are kept apart, most recently completed first.
 */
export function groupBySection(project: Pick<TaskProject, 'sections'> | null, tasks: readonly Task[]): SectionGroup[] {
  const sections = project?.sections ?? [];
  const known = new Set(sections.map((s) => s.id));
  const groups: SectionGroup[] = [{ section: null, open: [], done: [] }, ...sections.map((section) => ({ section, open: [], done: [] }))];
  const index = new Map(sections.map((s, i) => [s.id, i + 1] as const));
  for (const t of tasks) {
    const g = groups[t.sectionId && known.has(t.sectionId) ? index.get(t.sectionId)! : 0];
    (t.completedAt ? g.done : g.open).push(t);
  }
  for (const g of groups) {
    g.open.sort(byOrder);
    g.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  }
  return groups.filter((g) => g.section !== null || g.open.length > 0 || g.done.length > 0);
}

/** A task's direct subtasks, open ones in order first, then completed ones. */
export function subtasksOf(tasks: readonly Task[], parentId: string): Task[] {
  const children = tasks.filter((t) => t.parentId === parentId);
  const open = children.filter((t) => !t.completedAt).sort(byOrder);
  const done = children.filter((t) => t.completedAt).sort(byOrder);
  return [...open, ...done];
}

/** "2/5": how many direct subtasks are done. Null when there are none. */
export function subtaskProgress(tasks: readonly Task[], parentId: string): { done: number; total: number } | null {
  const children = tasks.filter((t) => t.parentId === parentId);
  if (children.length === 0) return null;
  return { done: children.filter((t) => t.completedAt).length, total: children.length };
}

/**
 * The sortOrder that puts a new task after every one in `siblings`: at least
 * the clock, so two tasks added in quick succession (before the list has
 * caught up) or on two devices still land in the order they were added.
 * Reordering renumbers a list from 0, which stays below any clock value.
 */
export function nextSortOrder(siblings: readonly { sortOrder?: number }[], now: number = Date.now()): number {
  return Math.max(now, siblings.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), 0) + 1);
}

/** The chain of parents above a subtask, nearest last ("Garage > Shelves"). */
export function parentChain(tasks: readonly Task[], task: Task): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const chain: Task[] = [];
  let current = task.parentId ? byId.get(task.parentId) : undefined;
  while (current && !chain.includes(current)) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** The top-level task a subtask belongs to (itself when it is one), so a subtask shows in its parent's project. */
export function rootOf(tasks: readonly Task[], task: Task): Task {
  return parentChain(tasks, task)[0] ?? task;
}

export interface ProjectSummary {
  open: number;
  overdue: number;
  dueToday: number;
  /** The nearest due date among open tasks that isn't overdue. */
  next?: DueText;
}

/** The numbers on a project's card: open top-level tasks, how many are overdue or due today, and the next due date. */
export function projectSummary(tasks: readonly Task[], projectId: string, today: string): ProjectSummary {
  const open = topLevelTasks(tasks, projectId).filter((t) => !t.completedAt);
  let overdue = 0;
  let dueToday = 0;
  let next: Task | undefined;
  for (const t of open) {
    if (!t.dueOn) continue;
    if (t.dueOn < today) overdue++;
    else if (t.dueOn === today) dueToday++;
    // A task without a time counts as any time that day, after the timed ones.
    if (t.dueOn >= today && (!next || t.dueOn < next.dueOn! || (t.dueOn === next.dueOn && (t.dueTime ?? '99:99') < (next.dueTime ?? '99:99')))) next = t;
  }
  return { open: open.length, overdue, dueToday, ...(next ? { next: describeDue(next.dueOn!, next.dueTime, today) } : {}) };
}

/** Projects in the list's order: by sortOrder where set, then by name; archived ones apart. */
export function orderProjects(projects: readonly TaskProject[]): { active: TaskProject[]; archived: TaskProject[] } {
  const sorted = [...projects].sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;
    return a.name.localeCompare(b.name);
  });
  return { active: sorted.filter((p) => !p.archived), archived: sorted.filter((p) => p.archived) };
}

/** Ready-made section sets for a new project. Generic on purpose. */
export const SECTION_TEMPLATES: ReadonlyArray<{ label: string; sections: string[] }> = [
  { label: 'No sections', sections: [] },
  { label: 'Now / Next / Later', sections: ['Now', 'Next', 'Later'] },
  { label: 'To do / Doing / Waiting', sections: ['To do', 'Doing', 'Waiting'] },
  { label: 'Weekly / Monthly / Seasonal / Yearly', sections: ['Weekly', 'Monthly', 'Seasonal', 'Yearly'] },
];

export const PROJECT_COLORS = ['#38bdf8', '#a855f7', '#22ff88', '#f97316', '#eab308', '#ec4899', '#ef4444', '#22d3ee', '#818cf8', '#10b981'];

/** Earliest due first; on the same day a timed task before the untimed ones, then by name. */
const byDue = (a: Task, b: Task) =>
  (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.name.localeCompare(b.name);

/**
 * Open tasks and subtasks due today or earlier, oldest first, leaving out
 * archived projects: what Today lists and the tab badge counts (3.62).
 */
export function dueTasks(tasks: readonly Task[], today: string, archivedProjectIds: ReadonlySet<string> = new Set()): Task[] {
  return tasks
    .filter((t) => {
      if (t.completedAt || !t.dueOn || t.dueOn > today) return false;
      const root = rootOf(tasks, t);
      return !root.projectId || !archivedProjectIds.has(root.projectId);
    })
    .sort(byDue);
}

export interface UpcomingGroup {
  key: string;
  label: string;
  state: DueState;
  tasks: Task[];
}

/**
 * Every open task and subtask with a due date, for the Upcoming page:
 * Overdue, Today, Tomorrow, each of the next five days by name, then by
 * month. Tasks in archived projects (and their subtasks) are left out.
 */
export function upcomingGroups(tasks: readonly Task[], today: string, archivedProjectIds: ReadonlySet<string> = new Set()): UpcomingGroup[] {
  const groups = new Map<string, UpcomingGroup>();
  const add = (key: string, label: string, state: DueState, t: Task) => {
    const g = groups.get(key) ?? { key, label, state, tasks: [] };
    g.tasks.push(t);
    groups.set(key, g);
  };
  const archived = (t: Task) => {
    const root = rootOf(tasks, t);
    return !!root.projectId && archivedProjectIds.has(root.projectId);
  };
  for (const t of [...tasks].sort(byDue)) {
    if (t.completedAt || !t.dueOn || archived(t)) continue;
    const days = daysFrom(today, t.dueOn);
    const date = new Date(dayStart(t.dueOn));
    if (days < 0) add('overdue', 'Overdue', 'overdue', t);
    else if (days === 0) add('today', 'Today', 'today', t);
    else if (days === 1) add('tomorrow', 'Tomorrow', 'soon', t);
    else if (days < 7) add(t.dueOn, date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), 'soon', t);
    else {
      const sameYear = date.getFullYear() === new Date(dayStart(today)).getFullYear();
      add(t.dueOn.slice(0, 7), date.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }), 'later', t);
    }
  }
  return [...groups.values()];
}

/** Where a task lives, for a list that mixes projects: "Home / Now", "Inbox", or "Subtask of Garage". */
export function taskContext(task: Task, tasks: readonly Task[], projects: readonly TaskProject[]): string {
  if (task.parentId) {
    const parent = tasks.find((t) => t.id === task.parentId);
    return parent ? `Subtask of ${parent.name}` : 'Subtask';
  }
  if (!task.projectId) return 'Inbox';
  const project = projects.find((p) => p.id === task.projectId);
  if (!project) return '';
  const section = project.sections.find((s) => s.id === task.sectionId);
  return section ? `${project.name} / ${section.name}` : project.name;
}

/** The quick date choices in a task's sheet and the reschedule sheet (3.64), from `today`. */
export function dateChoices(today: string): Array<{ label: string; dueOn: string }> {
  const add = (n: number) => addDaysKey(today, n);
  const weekday = weekdayOf(today); // 0 = Monday
  return [
    { label: 'Today', dueOn: today },
    { label: 'Tomorrow', dueOn: add(1) },
    // Saturday, or today when it's already the weekend.
    { label: 'This weekend', dueOn: weekday >= 5 ? today : add(5 - weekday) },
    { label: 'Next week', dueOn: add(7 - weekday) },
  ];
}

/** The web addresses in a task's notes, in order, without repeats, for links under the notes (3.64). */
export function linksIn(notes: string): string[] {
  const found = notes.match(/https?:\/\/[^\s<>"'`)\]]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, '')))];
}
