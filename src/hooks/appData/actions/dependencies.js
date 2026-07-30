import * as repository from "../../../data/repository.js";
import * as affiliations from "../../../lib/affiliations.js";
import * as queryPolicy from "../../../lib/queryPolicy.js";
import * as ratingPolicy from "../../../lib/ratingPolicy.js";
import * as roomChat from "../../../lib/roomChat.js";
import * as storage from "../../../lib/storage.js";
import * as supabaseClient from "../../../lib/supabase.js";
import * as teamEmblem from "../../../lib/teamEmblem.js";
import * as bootstrap from "../bootstrap.js";
import * as recordArchive from "../recordArchive.js";
import * as remoteMerge from "../remoteMerge.js";
import * as serverOperations from "../serverOperations.js";
import * as stateNormalization from "../stateNormalization.js";

export const APP_ACTION_DEPENDENCIES = Object.freeze({
  ...queryPolicy,
  ...ratingPolicy,
  ...recordArchive,
  ...roomChat,
  ...repository,
  ...serverOperations,
  ...bootstrap,
  ...remoteMerge,
  ...affiliations,
  ...stateNormalization,
  ...teamEmblem,
  ...supabaseClient,
  ...storage,
});
