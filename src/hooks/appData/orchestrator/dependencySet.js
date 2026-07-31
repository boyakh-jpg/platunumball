import * as React from "react";
import * as repository from "../../../data/repository.js";
import * as constants from "../../../lib/constants.js";
import * as courtCore from "../../../lib/courtCore.js";
import * as matchUtils from "../../../lib/matchUtils.js";
import * as queryPolicy from "../../../lib/queryPolicy.js";
import * as rating from "../../../lib/rating.js";
import * as recruiting from "../../../lib/recruiting.js";
import * as serverActions from "../../../lib/serverActions.js";
import * as storage from "../../../lib/storage.js";
import * as supabaseClient from "../../../lib/supabase.js";
import * as bootstrap from "../bootstrap.js";
import * as metadata from "../metadata.js";
import * as recordArchive from "../recordArchive.js";
import * as remoteMerge from "../remoteMerge.js";
import * as serverOperations from "../serverOperations.js";
import * as stateNormalization from "../stateNormalization.js";

export const APP_DATA_ORCHESTRATOR_DEPENDENCIES = Object.freeze({
  ...constants,
  ...courtCore,
  ...queryPolicy,
  ...matchUtils,
  ...repository,
  ...storage,
  ...serverActions,
  ...rating,
  ...supabaseClient,
  ...recruiting,
  ...bootstrap,
  ...metadata,
  ...recordArchive,
  ...remoteMerge,
  ...serverOperations,
  ...stateNormalization,
  ...React,
});
