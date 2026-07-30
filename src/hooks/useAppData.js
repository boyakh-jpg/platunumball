// Stable compatibility boundary. Implementations live in responsibility-specific modules.

export {
  mergeMatchesById,
  mergeRecruitingPostsById,
} from "./appData/remoteMerge.js";

export {
  useAppData,
} from "./appData/useAppDataOrchestrator.js";
