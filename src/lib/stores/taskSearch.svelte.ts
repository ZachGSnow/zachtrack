/**
 * The search box on Tasks (3.66): its text survives leaving the page and
 * coming back, and / on a laptop asks it for the focus.
 */
class TaskSearch {
  query = $state('');
  /** Bumped to ask the box to take the focus; `handled` is the last one it took. */
  focusRequest = $state(0);
  handled = 0;

  focus() {
    this.focusRequest++;
  }
}

export const taskSearch = new TaskSearch();
