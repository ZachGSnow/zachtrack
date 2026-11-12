import { describe, expect, it } from 'vitest';
import type { Task, TaskProject } from '../src/lib/db';
import {
  dayKey,
  daysFrom,
  describeDue,
  dueTasks,
  groupBySection,
  INBOX_ID,
  nextSortOrder,
  orderProjects,
  parentChain,
  projectSummary,
  rootOf,
  subtaskProgress,
  subtasksOf,
  taskContext,
  topLevelTasks,
  upcomingGroups,
} from '../src/lib/utils/tasks';

// What the Tasks screens show (ARCHITECTURE.md 3.60). Runs in America/New_York
// (vitest.config.ts), so the day math crosses a DST change.

let n = 0;
const task = (extra: Partial<Task> = {}): Task => ({ id: `k${++n}`, name: `Task ${n}`, sortOrder: n, createdAt: n, updatedAt: n, ...extra });
const project: Pick<TaskProject, 'sections'> = {
  sections: [
    { id: 's-now', name: 'Now' },
    { id: 's-later', name: 'Later' },
  ],
};

describe('days', () => {
  it('turns times into calendar days and counts days across a DST change', () => {
    expect(dayKey(new Date(2026, 10, 1, 23, 30).getTime())).toBe('2026-11-01');
    expect(daysFrom('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysFrom('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysFrom('2026-11-12', '2026-11-11')).toBe(-1);
  });

  it('describes a due date relative to today, with its state', () => {
    const today = '2026-11-11'; // a Wednesday
    expect(describeDue('2026-11-11', undefined, today)).toEqual({ text: 'Today', state: 'today' });
    expect(describeDue('2026-11-12', undefined, today)).toEqual({ text: 'Tomorrow', state: 'soon' });
    expect(describeDue('2026-11-10', undefined, today)).toEqual({ text: 'Yesterday', state: 'overdue' });
    expect(describeDue('2026-11-01', undefined, today).state).toBe('overdue');
    expect(describeDue('2026-11-13', undefined, today).text).toMatch(/Fri/);
    expect(describeDue('2026-11-30', undefined, today)).toMatchObject({ state: 'later' });
    expect(describeDue('2026-11-30', undefined, today).text).toMatch(/Nov/);
    expect(describeDue('2027-01-05', undefined, today).text).toMatch(/2027/);
    expect(describeDue('2026-11-11', '09:30', today).text).toMatch(/^Today, 9:30/);
  });
});

describe('a project page', () => {
  it('groups top-level tasks by section in the project order, keeping empty sections and completed tasks apart', () => {
    const loose = task({ projectId: 'p' });
    const gone = task({ projectId: 'p', sectionId: 's-removed' });
    const later1 = task({ projectId: 'p', sectionId: 's-later', sortOrder: 5 });
    const later0 = task({ projectId: 'p', sectionId: 's-later', sortOrder: 1 });
    const done = task({ projectId: 'p', sectionId: 's-later', completedAt: 100 });
    const doneLast = task({ projectId: 'p', sectionId: 's-later', completedAt: 200 });
    const groups = groupBySection(project, [later1, loose, done, later0, gone, doneLast]);
    expect(groups.map((g) => g.section?.id ?? null)).toEqual([null, 's-now', 's-later']);
    expect(groups[0].open.map((t) => t.id)).toEqual([loose.id, gone.id]);
    expect(groups[1].open).toEqual([]);
    expect(groups[2].open.map((t) => t.id)).toEqual([later0.id, later1.id]);
    expect(groups[2].done.map((t) => t.id)).toEqual([doneLast.id, done.id]);
  });

  it('leaves out the top group when nothing is outside a section', () => {
    expect(groupBySection(project, []).map((g) => g.section?.id)).toEqual(['s-now', 's-later']);
    expect(groupBySection(null, [])).toEqual([]);
  });

  it('takes only top-level tasks of the project, or those without a project for the inbox', () => {
    const inProject = task({ projectId: 'p' });
    const sub = task({ parentId: inProject.id });
    const inbox = task();
    const elsewhere = task({ projectId: 'q' });
    const all = [inProject, sub, inbox, elsewhere];
    expect(topLevelTasks(all, 'p').map((t) => t.id)).toEqual([inProject.id]);
    expect(topLevelTasks(all, INBOX_ID).map((t) => t.id)).toEqual([inbox.id]);
  });
});

describe('subtasks', () => {
  it('lists open subtasks in order, then completed ones, and counts them', () => {
    const parent = task();
    const b = task({ parentId: parent.id, sortOrder: 2 });
    const a = task({ parentId: parent.id, sortOrder: 1 });
    const done = task({ parentId: parent.id, sortOrder: 0, completedAt: 5 });
    const all = [parent, b, a, done];
    expect(subtasksOf(all, parent.id).map((t) => t.id)).toEqual([a.id, b.id, done.id]);
    expect(subtaskProgress(all, parent.id)).toEqual({ done: 1, total: 3 });
    expect(subtaskProgress(all, a.id)).toBeNull();
  });

  it('finds the parents above a subtask and the top-level task, without looping on a cycle', () => {
    const top = task();
    const mid = task({ parentId: top.id });
    const leaf = task({ parentId: mid.id });
    expect(parentChain([top, mid, leaf], leaf).map((t) => t.id)).toEqual([top.id, mid.id]);
    expect(rootOf([top, mid, leaf], leaf).id).toBe(top.id);
    expect(rootOf([top], top).id).toBe(top.id);
    const x = task({ id: 'x', parentId: 'y' });
    const y = task({ id: 'y', parentId: 'x' });
    expect(parentChain([x, y], x).map((t) => t.id)).toEqual(['x', 'y']);
  });
});

describe('order', () => {
  it('puts a new task after the others and after anything added a moment before', () => {
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 3 }], 1000)).toBe(1000);
    expect(nextSortOrder([{ sortOrder: 2000 }], 1000)).toBe(2001);
    expect(nextSortOrder([], 1000)).toBe(1000);
  });

  it('orders projects by their set order, then by name, with archived ones apart', () => {
    const p = (id: string, name: string, extra: Partial<TaskProject> = {}): TaskProject => ({ id, name, color: '#000', sections: [], createdAt: 1, updatedAt: 1, ...extra });
    const { active, archived } = orderProjects([p('c', 'Chores'), p('a', 'Areas'), p('z', 'Zoo', { sortOrder: 0 }), p('o', 'Old', { archived: true })]);
    expect(active.map((x) => x.id)).toEqual(['z', 'a', 'c']);
    expect(archived.map((x) => x.id)).toEqual(['o']);
  });
});

describe('a project card', () => {
  it('counts open top-level tasks, overdue and due today, and names the next due date', () => {
    const today = '2026-11-11';
    const tasks = [
      task({ projectId: 'p', dueOn: '2026-11-09' }),
      task({ projectId: 'p', dueOn: '2026-11-11' }),
      task({ projectId: 'p', dueOn: '2026-11-11', dueTime: '08:00' }),
      task({ projectId: 'p', dueOn: '2026-11-20' }),
      task({ projectId: 'p' }),
      task({ projectId: 'p', dueOn: '2026-11-01', completedAt: 5 }),
      task({ parentId: 'k1', dueOn: '2026-11-01' }),
    ];
    const s = projectSummary(tasks, 'p', today);
    expect(s).toMatchObject({ open: 5, overdue: 1, dueToday: 2 });
    expect(s.next?.text).toMatch(/^Today, 8:00/);
  });
});

describe('Upcoming and Today (3.62)', () => {
  const today = '2026-11-11';

  it('counts open tasks and subtasks due today or earlier, oldest first', () => {
    const later = task({ dueOn: '2026-11-12' });
    const late = task({ dueOn: '2026-11-02' });
    const now = task({ dueOn: today, dueTime: '07:00' });
    const sub = task({ parentId: 'x', dueOn: today });
    const done = task({ dueOn: '2026-11-01', completedAt: 1 });
    expect(dueTasks([later, sub, late, now, done], today).map((t) => t.id)).toEqual([late.id, now.id, sub.id]);
  });

  it('groups by Overdue, Today, Tomorrow, the days of the coming week and then months, leaving out archived projects', () => {
    const tasks = [
      task({ dueOn: '2026-11-01' }),
      task({ dueOn: today }),
      task({ dueOn: '2026-11-12' }),
      task({ dueOn: '2026-11-13' }),
      task({ dueOn: '2026-11-25' }),
      task({ dueOn: '2027-01-04' }),
      task(),
      task({ dueOn: today, projectId: 'old' }),
    ];
    const groups = upcomingGroups(tasks, today, new Set(['old']));
    expect(groups.map((g) => [g.key, g.tasks.length])).toEqual([
      ['overdue', 1],
      ['today', 1],
      ['tomorrow', 1],
      ['2026-11-13', 1],
      ['2026-11', 1],
      ['2027-01', 1],
    ]);
    expect(groups[3].label).toMatch(/Friday/);
    expect(groups[5].label).toMatch(/2027/);
  });

  it('says where a task lives', () => {
    const projects: TaskProject[] = [{ id: 'p', name: 'Home', color: '#000', sections: [{ id: 's', name: 'Now' }], createdAt: 1, updatedAt: 1 }];
    const top = task({ name: 'Garage', projectId: 'p', sectionId: 's' });
    const all = [top, task({ name: 'Hooks', parentId: top.id })];
    expect(taskContext(top, all, projects)).toBe('Home / Now');
    expect(taskContext(all[1], all, projects)).toBe('Subtask of Garage');
    expect(taskContext(task(), all, projects)).toBe('Inbox');
    expect(taskContext(task({ projectId: 'p' }), all, projects)).toBe('Home');
  });
});
