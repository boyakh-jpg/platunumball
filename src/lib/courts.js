import { COURTS } from "./constants.js";

export function getRegisteredCourts(stateOrSettings = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const approvedCourts = settings.approvedCourts ?? [];
  const byId = new Map(COURTS.map((court) => [court.id, court]));
  approvedCourts.forEach((court) => {
    if (!court?.id) return;
    byId.set(court.id, court);
  });
  return [...byId.values()];
}
