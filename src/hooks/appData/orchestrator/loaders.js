import { useDirectoryLoaders } from "./directoryLoaders.js";
import { useMatchLoaders } from "./matchLoaders.js";
import { useRecordLoaders } from "./recordLoaders.js";

export function useAppDataLoaders(context) {
  return {
    ...useMatchLoaders(context),
    ...useRecordLoaders(context),
    ...useDirectoryLoaders(context),
  };
}
