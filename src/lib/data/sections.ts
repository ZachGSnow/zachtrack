// The app's three sections (ARCHITECTURE.md 3.39): the tab bar on a phone,
// the sidebar on a laptop, and each section's own pages, switched with the
// tabs at the top of the page (SectionTabs.svelte) or the sidebar's indented
// links.

export interface SectionPage {
  href: string;
  label: string;
}

export interface Section {
  href: string;
  label: string;
  icon: string;
  /** The routes that belong to it, so its tab lights up on any of them. */
  match: RegExp;
  /** Its pages, when it has more than one. */
  pages?: SectionPage[];
}

export const SECTIONS: Section[] = [
  {
    href: '/',
    label: 'Fasting',
    icon: '\u23f1',
    match: /^\/(journey|history)?$/,
    pages: [
      { href: '/', label: 'Timer' },
      { href: '/journey', label: 'Journey' },
      { href: '/history', label: 'History' },
    ],
  },
  {
    href: '/trackables',
    label: 'Trackables',
    icon: '\u{1F4CB}',
    match: /^\/(trackables(\/.*)?|dates)$/,
    pages: [
      { href: '/trackables', label: 'List' },
      { href: '/dates', label: 'Dates' },
    ],
  },
  // '/charting' is the old address of the Data tab, kept so links to it still work.
  { href: '/insights', label: 'Insights', icon: '\u{1F4A1}', match: /^\/(insights|charting)$/ },
];

/** The section a route belongs to, and its page when the route is one of them exactly. */
export function sectionFor(location: string): { section: Section | undefined; page: SectionPage | undefined } {
  const section = SECTIONS.find((s) => s.match.test(location));
  return { section, page: section?.pages?.find((p) => p.href === location) };
}
