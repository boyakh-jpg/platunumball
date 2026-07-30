import { normalizeState } from "../../data/repository.js";

function normalizeServerState(state) {
  return state ? normalizeState(state, { includeDemo: false }) : state;
}

export {
  normalizeServerState,
};
