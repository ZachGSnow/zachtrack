class ZoneInfoStore {
  openZoneId = $state<string | null>(null);

  show(zoneId: string) {
    this.openZoneId = zoneId;
  }

  close() {
    this.openZoneId = null;
  }
}

export const zoneInfoStore = new ZoneInfoStore();
