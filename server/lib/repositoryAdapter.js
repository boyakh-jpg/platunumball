// Temporary bridge for the two server-side creation reducers and scoped loader.
// It imports their owning modules directly so the compatibility barrel is never
// part of the server graph.
export { configureServerRatingAuthority } from "../../src/data/repository/runtime.js";
export { confirmRecruitingMatch } from "../../src/data/repository/recruiting/confirmation.js";
export { createMatch } from "../../src/data/repository/matchCreation.js";
export { loadNormalizedRemoteStateFromClient } from "../../src/data/repository/remote/stateLoader.js";
