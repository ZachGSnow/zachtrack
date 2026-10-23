<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { tick } from 'svelte';

  // The in-app guide, bundled with the app so it works offline. /help/<topic>
  // opens at that topic; HelpLink.svelte puts "?" links to topics where
  // questions come up.
  let { params = {} }: { params?: { topic?: string } } = $props();

  const TOPICS = [
    { id: 'getting-started', title: 'Getting started' },
    { id: 'trackables', title: 'Trackables and what they show' },
    { id: 'goals', title: 'Goals' },
    { id: 'streaks', title: 'Streaks, rest days, skipping and pausing' },
    { id: 'grid', title: 'The habit grid' },
    { id: 'attention', title: 'Needs attention' },
    { id: 'insights', title: 'Insights' },
    { id: 'fasting', title: 'Fasting' },
    { id: 'data', title: 'Tables, the Data tab and your files' },
    { id: 'sync', title: 'Sync and privacy' },
  ];

  $effect(() => {
    const topic = params.topic;
    tick().then(() => {
      if (topic) document.getElementById(`help-${topic}`)?.scrollIntoView({ block: 'start' });
      else window.scrollTo({ top: 0 });
    });
  });
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-6 px-5 py-6 lg:max-w-3xl">
  <h1 class="text-xl font-semibold text-text">Help</h1>

  <nav aria-label="Help topics" class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);">
    <ul class="grid gap-1 text-sm sm:grid-cols-2">
      {#each TOPICS as t (t.id)}
        <li><a href="/help/{t.id}" use:link class="hover:underline" style="color: var(--color-brand);">{t.title}</a></li>
      {/each}
    </ul>
  </nav>

  <article class="help flex flex-col gap-8 text-sm leading-relaxed text-text">
    <section id="help-getting-started">
      <h2>Getting started</h2>
      <ol>
        <li>
          <strong>Install it.</strong> In Chrome on your phone, open the app's menu and choose Add to Home screen. It then opens like
          an app and works offline. A long press on its icon offers shortcuts: Start a fast, Trackables, Journey.
        </li>
        <li>
          <strong>Start a fast.</strong> On Fasting, pick a method (16:8 and so on, or "+ Your own" for a length of your own) and
          tap Start Fast. Tap the time to correct when it started.
        </li>
        <li>
          <strong>Track something.</strong> On Trackables, tap "+ New" and pick a template (Water, Workout, Weigh-in...) or make
          your own: a name, an icon and any fields you want to record, such as a number, a 1 to 5 rating or a yes/no.
        </li>
        <li>
          <strong>Give it a goal.</strong> In its Edit sheet, choose a goal: a daily total, times per day or week, every N days,
          or avoid it. Trackables with a goal get a check button and a habit grid on the list.
        </li>
        <li>
          <strong>Sync, or don't.</strong> With your own Cloudflare backend (see the README) your devices sync automatically.
          Without one the app runs local-only: the pill says Local only and your data stays on this device. Either way,
          Settings > Your data exports a backup file.
        </li>
      </ol>
    </section>

    <section id="help-trackables">
      <h2>Trackables and what they show</h2>
      <p>
        A trackable is anything you log: a habit, a reading, a meal, a symptom. Each one leads with what matters for its
        <em>kind</em>, which the app picks from its first field (Edit > Summary shows the choice and lets you change it):
      </p>
      <ul>
        <li><strong>Time since:</strong> no fields, so when it happens is the point. Shows how long ago and the usual gap.</li>
        <li><strong>Latest value:</strong> a reading like Weight. Shows the latest value and how it changed over about a week.</li>
        <li><strong>Daily total:</strong> a field that adds up, like Calories or Water. Shows today's total and your daily average.</li>
        <li><strong>Check-in:</strong> a rating or yes/no. Shows whether you logged today and your streak.</li>
        <li><strong>Ages:</strong> people by birthdate, with live ages and birthday countdowns.</li>
      </ul>
      <p>
        Fields are shared between trackables, and Edit on a field changes its name, unit or scale everywhere. A unit is only a
        label: changing it doesn't convert numbers already logged. "+" logs an entry; a trackable without fields logs in one
        tap, with a few seconds to undo.
      </p>
    </section>

    <section id="help-goals">
      <h2>Goals</h2>
      <ul>
        <li><strong>Reach a total each day:</strong> an amount of the first number field, like 64 oz of water. The card's button is a ring that fills toward it.</li>
        <li><strong>Times per day:</strong> log it N times a day. Without fields, each tap of the button counts one.</li>
        <li><strong>Times per week:</strong> the number of days you log it, Monday to Sunday. Due when every remaining day is needed, overdue when it can't be reached.</li>
        <li><strong>Every N days:</strong> due again N days after the last entry: "Due in 3d", "Due today", "Overdue by 2d".</li>
        <li><strong>Avoid it:</strong> for things you want to do less. The streak is the time since it last happened.</li>
      </ul>
      <p>A goal is optional. Without one, a trackable keeps a plain card with "+".</p>
    </section>

    <section id="help-streaks">
      <h2>Streaks, rest days, skipping and pausing</h2>
      <p>
        A streak counts the days (or weeks) in a row you met the goal, and today counts once it's met. Three things keep a
        streak from breaking when life gets in the way:
      </p>
      <ul>
        <li><strong>Rest days:</strong> a daily goal can apply on chosen weekdays only (Edit > On these days). Other days don't count and don't break it.</li>
        <li><strong>Skip a day:</strong> tap the day in the habit grid and choose Skip this day, for when you're sick or travelling.</li>
        <li><strong>Pause:</strong> Edit > Paused until, for a holiday. Nothing is due until then.</li>
      </ul>
    </section>

    <section id="help-grid">
      <h2>The habit grid</h2>
      <p>
        One square per day, weeks as columns, Monday at the top. The color shows how far that day went toward the goal: a
        partly filled square is part of a daily total or a times-per-day goal. For an avoid goal it's inverted, so clean days
        are full. A faint red square is a day an every-N-days goal fell overdue, an outlined one a rest, skipped or paused
        day, and a dim one a day before the trackable existed. Today has an outline.
      </p>
      <p>On a trackable's page, switch between Week, Month, 6 months and Year, and tap any day to see it or add an entry for that date.</p>
    </section>

    <section id="help-attention">
      <h2>Needs attention</h2>
      <p>
        Instead of notifications, reminders show inside the app. Goals that are overdue or due today are listed at the top of
        Trackables, most urgent first, and the Trackables tab shows how many. A dot on the Fasting tab means your daily fast
        start has passed and no fast has started yet.
      </p>
    </section>

    <section id="help-insights">
      <h2>Insights</h2>
      <p>A trackable's page lists a few patterns from your own entries:</p>
      <ul>
        <li><strong>Last 30 days:</strong> how often you met the goal, or logged it.</li>
        <li><strong>By weekday:</strong> the days you log it most and least, when the difference is clear.</li>
        <li>
          <strong>On days with:</strong> how its value (its first rating or number field, or whether you logged it) differs on days
          you also logged another trackable, with the number of days on each side.
        </li>
      </ul>
      <p>
        These are patterns, not causes. A comparison only shows with at least 5 days on each side and a difference large
        compared with the day-to-day spread, so small wobbles stay out.
      </p>
    </section>

    <section id="help-fasting">
      <h2>Fasting</h2>
      <p>
        The ring fills toward your fast's target and the markers are metabolic zones; tap one, or a zone card, to read about
        it. While fasting, the timer says when your eating window opens. With a daily start time (Settings > Fasting) the
        Fasting tab counts down to your next fast and says when you're late. Journey has your streaks, how often you hit the
        target, and charts. One fast per start day.
      </p>
      <p class="text-text-muted">
        The zone descriptions are general information, not medical advice. Talk to a doctor before extended fasting.
      </p>
    </section>

    <section id="help-data">
      <h2>Tables, the Data tab and your files</h2>
      <p>
        Trends tables show one row per day, week or month: weekly and monthly rows average the days you logged, and the gray
        line is the change from the previous period (or a 7-day average in day view). Copy puts a table on the clipboard for a
        spreadsheet. The Data tab lines up any mix of fasting and trackable columns to compare them.
      </p>
      <p>
        Settings > Your data: <strong>Export data</strong> saves everything as a JSON file, the one to restore from;
        <strong>Import file</strong> merges one back in (it never deletes); <strong>Export CSV</strong> gives one row per value
        for a spreadsheet. These files are your health data, so keep them somewhere private.
      </p>
    </section>

    <section id="help-sync">
      <h2>Sync and privacy</h2>
      <p>
        Your data lives on each device and, if you set up the backend, in a database in your own Cloudflare account behind
        Cloudflare Access. Nothing goes anywhere else and there are no analytics. The pill at the top (in the sidebar on a
        laptop) shows the sync status; tap it to sync now, double-tap for the recent syncs, also listed under Settings > Sync.
        If it says Login expired, use Log in again. Edits made on two devices are resolved record by record, and the newer one
        wins.
      </p>
    </section>
  </article>
</div>

<style>
  .help h2 {
    margin-bottom: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .help p + p,
  .help p + ul,
  .help ul + p {
    margin-top: 0.5rem;
  }
  .help ul,
  .help ol {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-left: 1.25rem;
  }
  .help ul {
    list-style: disc;
  }
  .help ol {
    list-style: decimal;
  }
  .help section {
    scroll-margin-top: 1rem;
  }
</style>
