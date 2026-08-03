import { DEFAULT_RATING } from "../../lib/constants.js";

let serverRatingAuthority = null;

export function configureServerRatingAuthority(authority = null) {
  serverRatingAuthority = authority;
}

function getServerRatingValue(method, ...args) {
  return serverRatingAuthority?.[method]?.(...args);
}

function getAveragePlayerMmr(state = {}, playerIds = [], fallback = DEFAULT_RATING) {
  const values = [...new Set(playerIds.filter(Boolean))]
    .map((playerId) => Number(state.users?.find((user) => user.id === playerId)?.ratings?.integrated))
    .filter(Number.isFinite);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : fallback;
}

export {
  getAveragePlayerMmr,
  getServerRatingValue,
};
