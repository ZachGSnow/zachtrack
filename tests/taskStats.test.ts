import { describe, expect, it } from 'vitest';
import type { Task, TaskCompletion, TaskProject } from '../src/lib/db';
import { doneSince, searchTasks, tallyTasks } from '../src/lib/utils/taskStats';

// Search, the Done page and task numbers (ARCHITECTURE.md 3.66).

const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
let n = 0;
const task = (extra: Partial<Task> = {}): Task => ({ id: `k${++n}`, name: `Task ${n}`, sortOrder: n, createdAt: 1, updatedAt: 1, ...extra });
const projects: TaskProject[] = [{ id: 'p', name: 'Garage', color: '#000', sections: [{ id: 's', name: 'Now' }], createdAt: 1, updatedAt: 1, archived: true }];

describe('search', () => {
  it('finds every word in the name or notes, any case, open tasks first', () => {
    const hooks = task({ name: 'Buy: J hooks', notes: 'Heavy duty, 50 lb', projectId: 'p', sectionId: 's', dueOn: '2026-11-20' });
    const liners = task({ name: 'Buy: shelf liners', notes: 'Alera 48x24 clear plastic', projectId: 'p', dueOn: '2026-11-15' });
    const done = task({ name: 'Buy: bins', completedAt: at(5) });
    const other = task({ name: 'Sweep' });
    const all = [hooks, liners, done, other];
    expect(searchTasks(all, projects, 'buy').map((h) => h.task.id)).toEqual([liners.id, hooks.id, done.id]);
    expect(searchTasks(all, projects, 'BUY clear').map((h) => h.task.id)).toEqual([liners.id]);
    expect(searchTasks(all, projects, 'nothing here')).toEqual([]);
    expect(searchTasks(all, projects, '  ')).toEqual([]);
  });

  it('says where a hit lives and shows the notes around a word found there', () => {
    const t = task({ name: 'Buy: J hooks', notes: 'For ladders and extension cords. Ignore the anchors that come with them; wood screws go into the girts instead.', projectId: 'p', sectionId: 's' });
    const [hit] = searchTasks([t], projects, 'hooks girts');
    expect(hit.context).toBe('Garage / Now');
    expect(hit.snippet).toMatch(/^\.\.\..*girts instead\.$/);
    expect(searchTasks([t], projects, 'hooks')[0].snippet).toBeUndefined();
  });
});

describe('done', () => {
  it('lists closed tasks and completions of repeating tasks by day, newest first, with how a repeat went', () => {
    const closed = task({ name: 'Return the drill', completedAt: at(10, 9) });
    const old = task({ name: 'Old', completedAt: at(1) });
    const oil = task({ name: 'Change oil', dueOn: '2027-05-01', repeat: { type: 'months', every: 6, day: 1 } });
    const completions: TaskCompletion[] = [
      { id: 'c1', taskId: oil.id, completedAt: at(10, 18), dueOn: '2026-11-08', createdAt: 1, updatedAt: 1 },
      { id: 'c2', taskId: oil.id, completedAt: at(11), dueOn: '2026-11-11', createdAt: 1, updatedAt: 1 },
      { id: 'c3', taskId: 'gone', completedAt: at(11), createdAt: 1, updatedAt: 1 },
    ];
    const days = doneSince([closed, old, oil], completions, projects, at(5));
    expect(days.map((d) => [d.day, d.items.map((i) => `${i.name}:${i.kind}:${i.timing ?? ''}`)])).toEqual([
      ['2026-11-11', ['Change oil:repeat:on time']],
      ['2026-11-10', ['Change oil:repeat:late', 'Return the drill:closed:']],
    ]);
  });

  it('tallies what got done in a range, and how many repeats were on time', () => {
    const tasks = [task({ completedAt: at(9) }), task({ completedAt: at(12) }), task({ completedAt: at(20) })];
    const completions: TaskCompletion[] = [
      { id: 'a', taskId: 'x', completedAt: at(10), dueOn: '2026-11-10', createdAt: 1, updatedAt: 1 },
      { id: 'b', taskId: 'x', completedAt: at(13), dueOn: '2026-11-11', createdAt: 1, updatedAt: 1 },
    ];
    expect(tallyTasks(tasks, completions, at(9, 0), at(16, 0))).toEqual({ done: 4, repeats: 2, repeatsOnTime: 1 });
  });
});
