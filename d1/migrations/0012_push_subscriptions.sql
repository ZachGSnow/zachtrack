-- Daily reminders on the phone (ARCHITECTURE.md 3.73). One row per device
-- that turned reminders on: where its browser's push service takes messages,
-- the keys to encrypt them for it, and when and what to remind it of. Not a
-- synced table and not in the nightly backups: a device that loses its row
-- turns reminders on again.

CREATE TABLE pushSubscriptions (
  -- The push service address the browser gave (PushSubscription.endpoint).
  endpoint TEXT PRIMARY KEY,
  -- The app's device id, so Settings can show this device's choices.
  deviceId TEXT,
  -- The browser's P-256 public key and auth secret, base64url.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- IANA time zone, e.g. America/New_York, and the local time to remind, "HH:MM".
  timeZone TEXT NOT NULL,
  remindAt TEXT NOT NULL,
  includeHabits INTEGER NOT NULL DEFAULT 1,
  includeTasks INTEGER NOT NULL DEFAULT 1,
  includeDates INTEGER NOT NULL DEFAULT 1,
  -- 1: name what's due; 0: counts only, since the lock screen shows it.
  namedText INTEGER NOT NULL DEFAULT 0,
  -- The local day the reminder last went, "YYYY-MM-DD", so it goes once a day.
  lastSentOn TEXT,
  -- Failed sends today; the run gives up for the day after a few.
  failures INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
