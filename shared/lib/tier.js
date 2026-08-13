// Shared tier presentation policy.
export const TIERS = [
  { name: "Rookie", min: 0, max: 799, color: "#9aa4b2" },
  { name: "Bronze", min: 800, max: 999, color: "#c58652" },
  { name: "Silver", min: 1000, max: 1199, color: "#c7d1dc" },
  { name: "Gold", min: 1200, max: 1399, color: "#f4c74f" },
  { name: "Platinum", min: 1400, max: 1599, color: "#58d2c0" },
  { name: "Diamond", min: 1600, max: 1799, color: "#74a8ff" },
  { name: "Master", min: 1800, max: 1999, color: "#d98cff" },
  { name: "Legend", min: 2000, max: 9999, color: "#ff6f61" },
];

export function getTier(mmr = 0) {
  return TIERS.find((tier) => mmr >= tier.min && mmr <= tier.max) ?? TIERS[0];
}

export function getTierLabel(mmr = 0) {
  return getTier(mmr).name.toUpperCase();
}

export function getTierDivisionNumber(mmr = 0) {
  const tier = getTier(mmr);
  if (tier.name === "Legend") return null;

  const span = Math.max(1, tier.max - tier.min + 1);
  const position = Math.min(span - 1, Math.max(0, mmr - tier.min));
  return Math.max(1, 4 - Math.floor((position / span) * 4));
}

export function getTierDivision(mmr = 0) {
  const label = getTierLabel(mmr);
  const division = getTierDivisionNumber(mmr);
  return division ? `${label} ${division}` : label;
}

export function getTierDisplay(mmr = 0) {
  return `${getTierDivision(mmr)} · ${Math.round(mmr)} MMR`;
}

export function getTierProgress(mmr = 0) {
  const tier = getTier(mmr);
  if (tier.name === "Legend") return 100;
  const span = tier.max - tier.min;
  return Math.round(((mmr - tier.min) / span) * 100);
}
