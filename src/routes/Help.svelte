<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { tick } from 'svelte';

  // The in-app guide, bundled with the app so it works offline. /help/<topic>
  // opens at that topic; HelpLink.svelte puts "?" links to topics where
  // questions come up.
  let { params = {} }: { params?: { topic?: string } } = $props();

  const TOPICS = [
    { id: 'getting-started', title: 'Getting started' },
    { id: 'today', title: 'Today' },
    { id: 'trackables', title: 'Trackables and what they show' },
    { id: 'dates', title: 'Dates: birthdays, holidays and countdowns' },
    { id: 'tasks', title: 'Tasks: projects, subtasks and repeating tasks' },
    { id: 'goals', title: 'Goals' },
    { id: 'streaks', title: 'Streaks, rest days, skipping and pausing' },
    { id: 'grid', title: 'The habit grid' },
    { id: 'attention', title: 'Needs attention' },
    { id: 'reminders', title: 'Daily reminders on your phone' },
    { id: 'insights', title: 'Insights' },
    { id: 'fasting', title: 'Fasting' },
    { id: 'data', title: 'Tables, comparing and your files' },
    { id: 'keyboard', title: 'On a laptop: keyboard shortcuts and filling in past days' },
    { id: 'sync', title: 'Sync and privacy' },
    { id: 'sync-page', title: 'Your devices, checking sync and signing out' },
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

  <nav aria-label="Help topics" class="rounded-2xl border p-4 border-border bg-surface">
    <ul class="grid gap-1 text-sm sm:grid-cols-2">
      {#each TOPICS as t (t.id)}
        <li><a href="/help/{t.id}" use:link class="hover:underline text-brand">{t.title}</a></li>
      {/each}
    </ul>
  </nav>

  <article class="help flex flex-col gap-8 text-sm leading-relaxed text-text">
    <section id="help-getting-started">
      <h2>Getting started</h2>
      <p class="mb-2">
        Six tabs: <strong>Today</strong> (what to do now), <strong>Fasting</strong> (the timer, Journey with your stats, and
        History of past fasts), <strong>Trackables</strong> (what you log), <strong>Dates</strong> (birthdays, anniversaries,
        holidays and countdowns: Coming up, Calendar and Lists), <strong>Tasks</strong> (your to-do list: Projects and
        Upcoming), and <strong>Insights</strong>. Switch a tab's
        pages with the buttons at the top of the page; on a laptop they're listed in the sidebar.
      </p>
      <ol>
        <li>
          <strong>Install it.</strong> In Chrome on your phone, open the app's menu and choose Add to Home screen. It then opens like
          an app and works offline. A long press on its icon offers shortcuts: Log weight, Start a fast, Trackables, Journey.
        </li>
        <li>
          <strong>Start a fast.</strong> On Fasting, pick a method (16:8 and so on, or "+ Your own" for a length of your own) and
          tap Start Fast. Tap the time to correct when it started.
        </li>
        <li>
          <strong>Pick a starting set.</strong> A fresh install offers eight starter trackables (Body Measurements, Sleep, Wellness
          Check-in and so on). Keep the ones you will log, or start empty; "+ New" adds more any time.
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

    <section id="help-today">
      <h2>Today</h2>
      <p class="mb-2">
        The app opens on Today: what to do now, gathered from every part of it. Each row links to where the rest lives.
      </p>
      <ul>
        <li>
          <strong>Since you were last here:</strong> after half a day or more away, a short list of what happened meanwhile: a fast
          that reached its goal, daily goals missed, dates that went by, and changes that synced in from your other devices.
          Dismiss hides it until the next time.
        </li>
        <li>
          <strong>Fasting:</strong> the running fast with its goal progress and zone, or, between fasts, your eating window and
          when the next fast is due, with one tap to start today's method (from your weekly plan, else the default). "More
          options" opens the timer for starting earlier or picking another method.
        </li>
        <li>
          <strong>Habits:</strong> every trackable with a goal, most urgent first, each with where it stands, its streak, how
          strong the habit is (shown first, since a missed day only dents it), and its check button. They're grouped into morning, afternoon and evening by when you usually log
          them. Done ones sink to the bottom; rest, skipped and paused days are greyed out and don't count. A trackable you log
          most days without a goal gets a suggested one, with "Not now" to hide it for a month.
        </li>
        <li>
          <strong>Strength</strong> is a forgiving score: every day you meet the goal raises it, and a missed day lowers it a
          little instead of resetting it, like a streak would. Rest, skipped and paused days leave it alone.
        </li>
        <li>
          <strong>A habit that slipped:</strong> when a habit that was going well has gone a week without being met, a card offers
          three ways back instead of a broken streak: pause it for a week, make the goal smaller for now, or start again. "Not
          now" hides it for two weeks.
        </li>
        <li>
          <strong>Weekly review:</strong> on Sundays (the week so far) and Mondays (the week just ended), habits met, your weight's
          7-day average against the week before, and fasts. Dismiss hides it until next week.
        </li>
        <li>
          <strong>Log:</strong> the trackables without a goal that you've logged in the last 30 days, with their latest reading
          and a "+". A reading like Weight has a box to type into and press Enter, and a check-in has its rating as taps, so
          the usual entries take no sheet at all. Anything quieter than that stays on the Trackables list.
        </li>
        <li><strong>Coming up:</strong> the next two weeks of birthdays, anniversaries, holidays and countdowns.</li>
        <li>
          <strong>Your data:</strong> whether your entries are safe: when this device last synced, when the server last made its
          nightly backup, and when you last exported a file here. It turns amber when this device holds the only copy or a
          backup is overdue, with a button to export one now.
        </li>
      </ul>
    </section>

    <section id="help-trackables">
      <h2>Trackables and what they show</h2>
      <p>
        A trackable is anything you log: a habit, a reading, a meal, a symptom. Each one leads with what matters for its
        <em>kind</em>, which the app picks from its first field (Edit > Summary shows the choice and lets you change it):
      </p>
      <ul>
        <li><strong>Time since:</strong> no fields, so when it happens is the point. Shows how long ago and the usual gap.</li>
        <li>
          <strong>Latest value:</strong> a reading like Weight. With a goal weight in Settings, changes toward it are green and
          away from it amber, and the chart draws the 7-day average through your readings. Shows the latest value, then its 7-day average against the week
          before and the trend per week over 30 days, so one high morning doesn't read as a gain. A new entry starts from your
          last readings: change what moved. On its page, <strong>Trend</strong> picks a 7-day average or a smoothed trend (a
          weighted average where each reading moves it a little, so it follows you without jumping), and "Lead with the trend"
          shows the trend first and the scale's reading second. With a goal weight, the page says when you'd reach it as a
          range of dates, since the pace wobbles.
        </li>
        <li><strong>Daily total:</strong> a field that adds up, like Calories or Water. Shows today's total and your daily average.</li>
        <li><strong>Check-in:</strong> a rating or yes/no. Shows whether you logged today and your streak.</li>
        <li>
          <strong>Dates:</strong> named dates with countdowns: birthdays, anniversaries, holidays, or countdowns and
          renewals. See <a href="/help/dates" use:link class="underline">Dates</a>.
        </li>
      </ul>
      <p>
        Fields are shared between trackables, and Edit on a field changes its name, unit or scale everywhere. A unit is only a
        label: changing it doesn't convert numbers already logged. "+" logs an entry; a trackable without fields logs in one
        tap, with a few seconds to undo.
      </p>
      <p>
        <strong>Split or merge.</strong> When one trackable holds two things you want to follow apart (each with its own
        goal), Edit > <strong>Split by field</strong> makes one trackable per field and moves each entry to the field it was
        logged with, keeping its time, note and values; entries with more than one of the fields stay where they are.
        <strong>Merge into...</strong> does the opposite, moving every entry into another trackable. Either way the
        trackable left empty is archived, not deleted, and Undo puts it all back for a few seconds.
      </p>
    </section>

    <section id="help-dates">
      <h2>Dates: birthdays, holidays and countdowns</h2>
      <p>
        Dates have their own tab, apart from the things you log. A date list holds named dates and counts down to each.
        Start one with Dates > "+ New list" and a template, or set an existing trackable's Summary to Dates. Edit > Dates
        are sets which kind it holds:
      </p>
      <ul>
        <li><strong>Birthdays:</strong> a name and a birthdate. Shows the age they turn and their age now.</li>
        <li><strong>Anniversaries:</strong> what it is and the date it started. Shows which anniversary ("12th") and how long since.</li>
        <li>
          <strong>Holidays:</strong> the same date every year, a weekday of a month (the 4th Thursday of November, the last
          Monday of May), or Easter and days from it (-2 is Good Friday). The US holidays template adds 18 of them; edit or
          delete any.
        </li>
        <li>
          <strong>Countdowns and renewals:</strong> a date that happens once (a trip), or repeats every few months or years
          (a passport every 10 years: enter when it's next due, or when it was last done). A one-off date that has passed moves
          under Past.
        </li>
      </ul>
      <p>Where they show:</p>
      <ul>
        <li>
          <strong>The Dates tab's count</strong>, a few days ahead: a week for birthdays and anniversaries, 3 days for
          holidays, 30 for countdowns. Change it in Edit > Show in Needs attention this many days ahead. The same dates show
          on Today, and in the daily reminder if you turn it on.
        </li>
        <li>
          <strong>Coming up</strong>: the next year from every date list, by week and month. <strong>Calendar</strong>: a
          month at a time; tap a day to see its dates.
        </li>
        <li><strong>Lists</strong>: your date lists, each with how many dates it holds and the next one, and "+" to add a date. Tap one to open it: its own page lists its dates.</li>
        <li>
          <strong>Notes</strong> on a date (gift ideas, sizes) show under it on its page and the Dates page, and go into the
          calendar export.
        </li>
        <li>
          <strong>Export to calendar</strong> on the Dates page downloads an .ics file. Import it into Google Calendar (Settings >
          Import) or any calendar app: birthdays, anniversaries and holidays repeat there on their own. The file is made on
          your device; nothing is uploaded. Importing again later adds copies, so delete the old calendar first. Tick
          "with reminders" to add an alert to each one, as many days ahead as its own reminder in the app. A February 29 birthday
          falls on February 28 in other years.
        </li>
      </ul>
    </section>

    <section id="help-tasks">
      <h2>Tasks: projects, subtasks and repeating tasks</h2>
      <p>A to-do list: things to finish, each with a checkbox, rather than things you log.</p>
      <ul>
        <li>
          <strong>Projects and sections.</strong> Tasks > "+ Project" names it and starts it with a set of sections (Now /
          Next / Later and so on) or none. Edit on a project renames, reorders, adds or removes sections; a removed section's
          tasks move to the top. Tap a section's name to fold it. Tasks without a project go to the Inbox.
        </li>
        <li>
          <strong>Adding.</strong> Type in "+ Add a task" at the end of a section and press Enter; type the next one straight
          away. Or add from anywhere: "+ Task" on Tasks and Upcoming, "+ Add" on Today, Q on a laptop, or "Add a task" from a
          long press on the app's icon.
        </li>
        <li>
          <strong>Dates in plain words.</strong> End a task with when it's due and the app sets it: "Pay bills fri", "Call the
          dentist tomorrow 9am", "Taxes apr 15", "Check tires in 3 weeks". Repeats work the same way: "Water plants every 3
          days", "Take the bins out every week on sun", "Pay rent every month on the 1st", "Book club every first wed", "Change
          oil 6 months after done". The line under the box shows what will be set; "Keep ... in the name" ignores it.
        </li>
        <li>
          <strong>Reordering.</strong> Drag a task by the dots at its left, within a section or into another; the same works
          for subtasks in a task's sheet and for sections in Edit. With a mouse, drag a task from anywhere on it. On a laptop,
          focus the dots and use the arrow keys.
        </li>
        <li>
          <strong>Board.</strong> List / Board at the top of a project shows its sections as columns of cards, as in Asana or
          Trello. Drag a card into another column to move it there, and a column by the dots in its header to reorder the
          sections. Each column has "+ Add a task" at its foot, and "+ Add a section" after the last adds a column. On a
          phone one column shows at a time: swipe sideways, or tap a column's name above the board. Each project remembers
          List or Board on each device.
        </li>
        <li>
          <strong>Swipes (phone).</strong> Swipe a task right to complete it, left to move its date.
        </li>
        <li>
          <strong>Subtask of, Duplicate.</strong> In a task's sheet, "Subtask of" puts it under another task in the same project,
          or makes a subtask a task of its own. Duplicate copies it with its subtasks, all open again.
        </li>
        <li>
          <strong>Moving dates.</strong> Tap a task's date to move it to Today, Tomorrow, This weekend, Next week or another
          day. "Move all overdue to today" on Today and Upcoming moves every late task at once, with Undo.
        </li>
        <li>
          <strong>A task's sheet.</strong> Tap a task to open it: its name, project and section, due date and time, notes and
          subtasks. Everything saves as you change it. A subtask opens in the same sheet, with "Subtask of ..." to go back.
        </li>
        <li>
          <strong>Completing.</strong> Tap the circle. Undo appears for a few seconds. Completed tasks hide; "Show completed"
          brings them back, and tapping a filled circle reopens one.
        </li>
      </ul>
      <p><strong>Repeating tasks.</strong> With a due date set, Repeat makes it come round again:</p>
      <ul>
        <li>Daily (or every few days), Weekly on the days you pick, Monthly on a date or the last day, Monthly on a weekday (the first Wednesday, the last Friday), Yearly, or a set time after it's done (180 days after the last oil change).</li>
        <li>
          Completing a repeating task doesn't close it: it moves to its next date, and its done subtasks are unchecked for
          next time. Done early, the next date stays on schedule. Done late, it moves to the next date after today, so it isn't
          overdue for turns you've already missed. "After it's done" counts from the day you complete it.
        </li>
        <li>Undo puts the date and the subtasks back. "Skip this one" moves it on without counting it as done.</li>
        <li>Moving the due date takes the rule with it: weekly on Thursday becomes weekly on Wednesday if you move it to a Wednesday.</li>
        <li>Its sheet lists when it was done, and whether that was on time, late or early.</li>
      </ul>
      <p><strong>Where tasks show.</strong></p>
      <ul>
        <li><strong>Upcoming</strong> (Tasks > Upcoming): everything with a due date, from every project, overdue first, then by day and month.</li>
        <li><strong>Done</strong> (Tasks > Done): what you completed over the last week, month or year, by day, with each repeat marked on time, late or early.</li>
        <li><strong>Search</strong> (the box on Tasks, or / on a laptop): finds tasks by any words in their name or notes, in every project. "Buy:" finds everything to buy.</li>
        <li><strong>Insights</strong> counts tasks done over the last 30 days and in Year in review, and the weekly review on Today counts that week's.</li>
        <li><strong>Today</strong> lists tasks overdue or due today, and the Tasks tab shows how many. No notifications, as with goals.</li>
        <li>An archived project's tasks leave Upcoming, Today and the count.</li>
      </ul>
      <p>
        <strong>Task or goal?</strong> A trackable with a goal is for something you keep doing and want a streak and a
        history of (water, weigh-ins). A task is for something to get done, with a due date, subtasks or a project.
      </p>
      <p>
        <strong>Moving from another app.</strong> Tasks come in through Settings > Your data > Import, in a ZachTrack export
        file. Importing merges: nothing here is deleted, and a record already here is only replaced by a newer copy.
      </p>
    </section>

    <section id="help-goals">
      <h2>Goals</h2>
      <ul>
        <li><strong>Reach a total each day:</strong> an amount of the first number field, like 64 oz of water. The card's button is a ring that fills toward it.</li>
        <li><strong>Times per day:</strong> log it N times a day. Without fields, each tap of the button counts one.</li>
        <li><strong>Times per week:</strong> the number of days you log it, Monday to Sunday. Due when every remaining day is needed, overdue when it can't be reached.</li>
        <li><strong>Every N days:</strong> due again N days after the last entry: "Due in 3d", "Due today", "Overdue by 2d".</li>
        <li><strong>At most N a week:</strong> for things you want to do less, but not never. Each time counts, Monday to Sunday; over the limit it turns red. The streak is weeks in a row within the limit. It never shows in Needs attention: there is nothing to do about it today.</li>
        <li><strong>Avoid it:</strong> for things you want to stop. The streak is the time since it last happened.</li>
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
        <li><strong>Rest days:</strong> a daily goal can apply on chosen weekdays only (Edit > On these days). Other days don't count and don't break it. Changing the days applies from today on: past days keep the schedule they had.</li>
        <li><strong>Skip a day:</strong> tap the day in the habit grid and choose Skip this day, for when you're sick or travelling.</li>
        <li><strong>Pause:</strong> Edit > Paused until, for a holiday. Nothing is due until then.</li>
      </ul>
    </section>

    <section id="help-grid">
      <h2>The habit grid</h2>
      <p class="mb-2">
        Today shows every habit's last 7 days in one place. Tap a day to log it, or to take a logged day back off; a trackable with
        fields opens the entry sheet for that day.
      </p>
      <p>
        One square per day, weeks as columns, Monday at the top. The color shows how far that day went toward the goal: a
        partly filled square is part of a daily total or a times-per-day goal. For an avoid goal it's inverted, so clean days
        are full. An outlined square is a rest, skipped or paused day, and a dim one a day before the trackable existed.
        Today has an outline.
      </p>
      <p class="mt-2">
        <strong>Red</strong> is where the goal wasn't met. A faint red square is a daily goal's day that went by unmet (with
        a red ring if it was partly done), a day an every-N-days goal fell overdue, or a day in a week a times-per-week goal
        missed (this week too, once it can no longer be reached). Goals for less: a slip on an avoid goal is red, and once an
        at-most goal goes over its limit, that whole week is red, the days you logged solid. A week with a paused or skipped
        day isn't held against a weekly goal.
      </p>
      <p class="mt-2">
        Point at a day (or tap it on the Trackables list) to see its date, what was logged and, on a red day, why. Every goal
        shows its grid on the Trackables list, goals for less too. On a trackable's page, switch between Week, Month, 6
        months and Year, and tap any day to see it or add an entry for that date.
      </p>
    </section>

    <section id="help-attention">
      <h2>Needs attention</h2>
      <p>
        Reminders show inside the app, and once a day on your phone if you turn that on (see
        <a href="/help/reminders" use:link class="underline">Daily reminders</a>). Goals that are overdue or due today are listed at the top of
        Trackables, most urgent first, and the Trackables tab shows how many. Dates coming up soon (a birthday a week ahead,
        by default) are counted on the Dates tab instead, and both show on Today. A dot on the Fasting tab means a new fasting
        milestone, or that your daily fast
        start has passed and no fast has started yet.
      </p>
    </section>

    <section id="help-reminders">
      <h2>Daily reminders on your phone</h2>
      <p>
        Settings > <strong>Reminders</strong> sends one notification a day, at the time you pick, when something needs a
        look: habits due or overdue, tasks due today or overdue, and dates coming up. Nothing comes on a day with nothing
        due. It works with the app closed; tap it to open Today.
      </p>
      <p>
        Each device turns it on for itself, and the phone asks for permission first. On Android, install ZachTrack to the
        home screen from Chrome; on an iPhone, add it to the home screen first. <strong>Name what's due</strong> is off at
        first: the notification then gives only counts ("2 habits and 1 task need a look today"), since the lock screen
        shows it. <strong>Send a test</strong> checks it arrives. A phone saving battery can hold a notification back for
        a few minutes.
      </p>
      <p>
        The server works out what's due with the same rules as the app, in your phone's time zone, and sends it through
        your browser's push service (Google's, on Android), encrypted so only your phone can read it. Goals for less
        (Avoid it, At most N a week) never remind you.
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
          you also logged another trackable, with the number of days on each side. "On days after" does the same for the day
          after, like a late meal in the next morning's weight. "On days with a goal fast" compares days a fast that met its goal
          ended against the rest.
        </li>
        <li>
          <strong>Hide</strong> next to a comparison hides it on every device; Settings > Hidden comparisons brings it back. To keep
          a trackable out of comparisons altogether, its own and the others', tick "Keep out of comparisons" in its Edit sheet.
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
        it. Under the timer: when the fast started, when the goal is and how long is left, and the next zone. One fast per
        start day. This week sits under it as a dot per day: filled for a goal fast, half for one that fell short, hollow
        for a rest day. Between fasts the zones wait behind "About the zones", and after a fortnight without a goal fast a
        card sums up your year and offers a shorter method to come back with. During a long fast, "Log 16 oz water" adds a
        glass to your Water field. History opens with a month calendar: a full day met its goal, the right edge shows each
        week's goal fasts and hours, and a tap on a day opens its fast.
      </p>
      <ul>
        <li><strong>Forgot to start?</strong> Under Started, pick 30m, 1h or 2h ago, or a time, before Start Fast. Tap the timer to correct the start later.</li>
        <li><strong>Change goal</strong> switches the running fast to another method or length; it keeps its start time.</li>
        <li><strong>Milestones</strong> show in the app, not as notifications: a banner when you reach a new zone or your goal, and a dot on the Fasting tab until you dismiss it.</li>
        <li><strong>End Fast</strong> shows how long it was and how it compares with the goal; Add details for how you felt, tags and a note, or just Save & Finish.</li>
      </ul>
      <p>
        Between fasts, the Fasting tab shows your eating window: the rest of the day after a fast under 24 hours (8 hours after
        16:8), and how long ago the last fast ended. With a daily start time (Settings > Fasting) it counts down to your next
        fast and says when you're late. Forgot to time a fast altogether? History > Log a past fast.
      </p>
      <p>
        <strong>Weekly plan</strong> (Settings > Fasting): give each weekday its own method and start time, or make it a rest
        day. Start Fast picks the day's method, the countdown uses the day's time, and nothing is late on a rest day. A day
        left on Default uses the default method and the daily start time.
      </p>
      <p>
        <strong>Long fasts:</strong> from 20 hours in, or with a goal past a day, the timer adds a card about water and
        electrolytes, with cautions at 48 and 72 hours, and ending a fast of a day or more says how to break it gently.
      </p>
      <p>
        <strong>Journey:</strong> the goal streak counts days in a row with a fast that met its goal (a count-up fast counts
        from 12 hours), next to the days you fasted in the last 30. Below: this week against last week, a habit grid of fasting
        days (a full square met its goal), insights, the table and charts. The weight insight compares how your weight changes
        the day after a goal fast with other days, and only shows with at least 5 days on each side and a clear difference.
      </p>
      <p class="text-text-muted">
        The zones follow human research where it exists, and each says how sure the science is: the times are typical and
        shift with your last meal, activity and body, and some popular claims (an hour when autophagy starts, an immune
        "reset") rest mostly on animal studies. General information, not medical advice. Talk to a doctor before extended
        fasting.
      </p>
    </section>

    <section id="help-data">
      <h2>Tables, comparing and your files</h2>
      <p>
        Trends tables show one row per day, week or month: weekly and monthly rows average the days you logged, and the gray
        line is the change from the previous period (or a 7-day average in day view). Copy puts a table on the clipboard for a
        spreadsheet. The Insights tab starts with an overview (fasting and each trackable's last 30 days and streak) and
        the clearest patterns across your trackables, a Year in review (this year so far, or an earlier one: fasts, hours,
        your longest fast and goal streak, entries, the busiest month and what you logged most), then Compare lines up any
        mix of fasting and trackable columns.
      </p>
      <p>
        Settings > Your data: <strong>Export data</strong> saves everything as a JSON file, the one to restore from;
        <strong>Import file</strong> merges one back in (it never deletes); <strong>Export CSV</strong> gives one row per value
        for a spreadsheet. These files are your health data, so keep them somewhere private.
      </p>
      <p>
        <strong>Weigh-ins from a scale app:</strong> the app can't read Apple Health or Health Connect, so it takes the CSV file
        your scale's app exports instead (Renpho, Withings, Fitbit, Garmin, Eufy, Google Fit and the like). It finds the date and
        weight columns itself, converts kg or stone to your unit, shows what it will add, and leaves out days you already
        logged the same weight.
      </p>
    </section>

    <section id="help-keyboard">
      <h2>On a laptop: keyboard shortcuts and filling in past days</h2>
      <p class="mb-2">
        Single keys move around when you aren't typing in a box: <kbd>T</kbd> Today, <kbd>F</kbd> the fasting timer,
        <kbd>J</kbd> Journey, <kbd>H</kbd> fasting History, <kbd>L</kbd> the Trackables list, <kbd>D</kbd> Dates,
        <kbd>I</kbd> Insights, <kbd>S</kbd> Settings, <kbd>W</kbd> a weigh-in, and <kbd>?</kbd> shows the list. They never use
        Ctrl, Alt or Cmd, so the browser's own shortcuts still work.
      </p>
      <p>
        <strong>Fill in past days</strong> on a trackable's page opens a table of the last 7 or 14 days with a cell for each
        field, for catching up after a trip in one go. Tab moves between cells, each filled day becomes one entry at noon, and
        the last column shows what a day already has.
      </p>
    </section>

    <section id="help-sync">
      <h2>Sync and privacy</h2>
      <p>
        Your data lives on each device and, if you set up the backend, in a database in your own Cloudflare account behind
        Cloudflare Access. Nothing goes anywhere else and there are no analytics.
      </p>
      <ul>
        <li>
          <strong>When it syncs:</strong> a few seconds after each change, when you come back to the app or back online, and
          every few minutes while it's open. Each sync sends only what changed; once a day it sends everything as a check.
        </li>
        <li>
          <strong>The pill</strong> at the top (in the sidebar on a laptop) shows the status: tap it to sync now, double-tap for
          the recent syncs. Offline, it shows how many changes are waiting. If it says Login expired, use Log in again.
        </li>
        <li>
          <strong>Two devices, one record:</strong> edits are resolved record by record and the newer one wins. When that
          replaces an edit you made here, the history says so in amber.
        </li>
      </ul>
      <p>
        Devices, the activity on all of them, checking sync and signing out are on the Sync page: see
        <a href="/help/sync-page" use:link class="underline">Your devices, checking sync and signing out</a>.
      </p>
    </section>

    <section id="help-sync-page">
      <h2>Your devices, checking sync and signing out</h2>
      <p>The Sync page (Settings > Sync, or the sync pill's history) has:</p>
      <ul>
        <li>
          <strong>This device:</strong> its name in the device list and activity (rename it there) and its app version. When
          another device runs a newer version, it says to reopen the app here to update.
        </li>
        <li>
          <strong>Your devices:</strong> every device that synced in the last 90 days, with its version and last sync. An older
          version is flagged: reopen the app on it, since an older version can clear settings a newer one added. Remove only
          tidies the list; it doesn't sign anything out.
        </li>
        <li>
          <strong>Activity on all devices:</strong> each sync that changed something, from any device, for 90 days: what kind
          of record and its name, never values or notes. Tap a row for the names.
        </li>
        <li>
          <strong>Check sync</strong> compares how many records this device and the server have. <strong>Full resync</strong>
          sends and receives everything again, without deleting anything here first; use it when Check sync finds a difference.
        </li>
        <li><strong>This device's syncs:</strong> 30 days of what each sync sent and received, and how long it took.</li>
      </ul>
      <p>Signing out, in Settings > Sync:</p>
      <ul>
        <li>
          <strong>Sign out</strong> ends the Cloudflare login on <em>every</em> device, not just this one: Cloudflare signs
          you out everywhere at once. Your data stays on each device and syncs again after you log in.
        </li>
        <li>
          <strong>Sign out and erase this device</strong> also deletes everything stored here, after a confirmation that says
          whether any change hasn't reached the server. Use it on a device you're giving away.
        </li>
        <li>
          <strong>A lost phone:</strong> in the Cloudflare dashboard, Zero Trust > Access > Applications > your app > Revoke
          existing tokens stops it syncing. What's already on it is protected by the phone's own lock.
        </li>
      </ul>
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
