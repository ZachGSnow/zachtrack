// The app's sections (ARCHITECTURE.md 3.39 and 3.41): the tab bar on a phone,
// the sidebar on a laptop, and each section's own pages, switched with the
// tabs at the top of the page (SectionTabs.svelte) or the sidebar's indented
// links.

import type { LucideIcon } from '@lucide/svelte';
import House from '@lucide/svelte/icons/house';
import Timer from '@lucide/svelte/icons/timer';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Lightbulb from '@lucide/svelte/icons/lightbulb';
import ListTodo from '@lucide/svelte/icons/list-todo';
import CalendarDays from '@lucide/svelte/icons/calendar-days';

export interface SectionPage {
  href: string;
  label: string;
}

export interface Section {
  href: string;
  label: string;
  /** A lucide icon component (24px grid), drawn at the size the nav asks for. */
  icon: LucideIcon;
  /** The routes that belong to it, so its tab lights up on any of them. */
  match: RegExp;
  /** Its pages, when it has more than one. */
  pages?: SectionPage[];
}

export const SECTIONS: Section[] = [
  // Today is the home: what to do now, from every part of the app.
  { href: '/', label: 'Today', icon: House, match: /^\/$/ },
  {
    href: '/fasting',
    label: 'Fasting',
    icon: Timer,
    match: /^\/(fasting|journey|history)$/,
    pages: [
      { href: '/fasting', label: 'Timer' },
      { href: '/journey', label: 'Journey' },
      { href: '/history', label: 'History' },
    ],
  },
  { href: '/trackables', label: 'Trackables', icon: ListChecks, match: /^\/trackables(\/.*)?$/ },
  // Birthdays, anniversaries, holidays and countdowns: dates to look up, not things to log (ARCHITECTURE.md 3.75).
  {
    href: '/dates',
    label: 'Dates',
    icon: CalendarDays,
    match: /^\/dates(\/.*)?$/,
    pages: [
      { href: '/dates', label: 'Coming up' },
      { href: '/dates/calendar', label: 'Calendar' },
      { href: '/dates/lists', label: 'Lists' },
    ],
  },
  // To-dos: projects, sections, tasks and subtasks (ARCHITECTURE.md 3.59, 3.60).
  {
    href: '/tasks',
    label: 'Tasks',
    icon: ListTodo,
    match: /^\/tasks(\/.*)?$/,
    pages: [
      { href: '/tasks', label: 'Projects' },
      { href: '/tasks/upcoming', label: 'Upcoming' },
      { href: '/tasks/done', label: 'Done' },
    ],
  },
  // '/charting' is the old address of the Data tab, kept so links to it still work.
  { href: '/insights', label: 'Insights', icon: Lightbulb, match: /^\/(insights|charting)$/ },
];

/** The section a route belongs to, and its page when the route is one of them exactly. */
export function sectionFor(location: string): { section: Section | undefined; page: SectionPage | undefined } {
  const section = SECTIONS.find((s) => s.match.test(location));
  return { section, page: section?.pages?.find((p) => p.href === location) };
}
