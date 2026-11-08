import { db, type FieldDefinition, type SettingsRecord, type TrackableDefinition } from './db';
import { resolveBodyFieldIds } from './utils/health';

/**
 * The trackable a weigh-in goes into: the one holding the weight field (the
 * field BMI follows, 3.14), preferring one that isn't archived. Used by the
 * Log weight home-screen shortcut and the W key.
 */
export function weighInHolder(trackables: readonly TrackableDefinition[], fields: readonly FieldDefinition[], settings: Partial<SettingsRecord>): TrackableDefinition | undefined {
  const weightId = resolveBodyFieldIds([...fields], settings).weight;
  if (!weightId) return undefined;
  return trackables.filter((t) => t.fieldIds.includes(weightId)).sort((a, b) => Number(!!a.archived) - Number(!!b.archived))[0];
}

/** weighInHolder, read from the database. */
export async function weighInTrackable(settings: Partial<SettingsRecord>): Promise<TrackableDefinition | undefined> {
  const [fields, trackables] = await Promise.all([db.fieldDefinitions.toArray(), db.trackableDefinitions.toArray()]);
  return weighInHolder(trackables, fields, settings);
}
