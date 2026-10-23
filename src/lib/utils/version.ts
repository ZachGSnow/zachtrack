// App versions ("1.10.0") as the device list shows them: which devices run an
// older build than the newest one seen, so they can be reopened to update.

/** Negative when a is older than b, positive when newer, 0 when the same. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The newest of these versions, or undefined when there are none. */
export function newestVersion(versions: Array<string | undefined>): string | undefined {
  return versions.filter((v): v is string => !!v).reduce<string | undefined>((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), undefined);
}
