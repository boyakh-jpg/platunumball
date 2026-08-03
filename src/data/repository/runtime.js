import { DEFAULT_RATING } from "../../lib/constants.js";
import { getPlayerMatchModeMmr } from "../../lib/recruiting.js";

let serverRatingAuthority = null;

export function configureServerRatingAuthority(authority = null) {
  serverRatingAuthority = authority;
}

function getServerRatingValue(method, ...args) {
  return serverRatingAuthority?.[method]?.(...args);
}

function getAveragePlayerMmr(state = {}, playerIds = [], fallback = DEFAULT_RATING, mode = "") {
  const values = [...new Set(playerIds.filter(Boolean))]
    .map((playerId) => state.users?.find((user) => user.id === playerId))
    .filter(Boolean)
    .map((user) => getPlayerMatchModeMmr(user, mode))
    .filter(Number.isFinite);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : fallback;
}

export {
  getAveragePlayerMmr,
  getServerRatingValue,
};
