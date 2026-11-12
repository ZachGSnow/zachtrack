/**
 * The quick-add sheet (QuickAddSheet.svelte, mounted once in App.svelte):
 * add a task from anywhere, with its date typed in plain words (3.64). Opened
 * by Q on a laptop, the "+" buttons on Today, Tasks and Upcoming, and the
 * home-screen shortcut. It starts in the project (and section) it was opened
 * from, or the inbox.
 */
class QuickAddStore {
  open = $state(false);
  projectId = $state<string | undefined>(undefined);
  sectionId = $state<string | undefined>(undefined);

  show(projectId?: string, sectionId?: string) {
    this.projectId = projectId;
    this.sectionId = sectionId;
    this.open = true;
  }
}

export const quickAdd = new QuickAddStore();
