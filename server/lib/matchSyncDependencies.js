import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson, toArray, toNotificationRows, uniqueValues as uniqueIds } from "../api/_supabaseAdmin.js";
import {
  DEFAULT_TOURNAMENT_MMR_GAP,
  MATCH_SIDES,
  PLAYER_STAT_FIELD_IDS as PLAYER_STAT_FIELDS,
  RECORD_TYPES,
  isRefereeGrade,
} from "../../shared/lib/constants.js";
import { PROFILE_CARD_COLUMNS, PROFILE_ME_COLUMNS, TEAM_COLUMNS, TEAM_MEMBER_COLUMNS } from "../../shared/lib/repositoryColumns.js";
import { fromRemoteProfile } from "../../shared/lib/profileMappers.js";
import { fromRemoteTeam } from "../../shared/lib/teamMappers.js";
import { hasPracticeMutationPayload, PRACTICE_LOCAL_ONLY_ERROR } from "../../shared/lib/practiceMode.js";
import { sortPlainObject } from "../../shared/lib/plainObject.js";
import { projectTournamentDbIdentity } from "./tournamentPersistence.js";
import {
  MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS,
  getMatchParticipantIds as getParticipantIds,
  queueMatchDiscordDeliveries,
  queueMatchParticipationCancellationDeliveries,
} from "./matchNotifications.js";
import {
  getMatchPlayedIdMap,
  getSidePlayerRows,
  toAgreementRows,
  toApprovalRows,
  toAuthoritativeMatchRow,
  toAuthoritativePlayerStatRows,
  toDisputeRows,
  toResultRow,
} from "./matchSnapshotRows.js";
import {
  validateMatchCreateCourt,
  validateMatchRosterEligibility,
  validateMatchShape,
  validateResultShape,
  validateSoloRecordSnapshot,
} from "./matchSnapshotValidation.js";
import {
  applyAuthoritativeMatchOperation,
  getOperation,
  loadAuthoritativeState,
} from "../api/_authoritativeState.js";

export const MATCH_SYNC_DEPENDENCIES = {
  allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson, toArray, toNotificationRows, uniqueIds, DEFAULT_TOURNAMENT_MMR_GAP,
  MATCH_SIDES, PLAYER_STAT_FIELDS, RECORD_TYPES, isRefereeGrade, PROFILE_CARD_COLUMNS, PROFILE_ME_COLUMNS, TEAM_COLUMNS,
  TEAM_MEMBER_COLUMNS, fromRemoteProfile, fromRemoteTeam, hasPracticeMutationPayload, PRACTICE_LOCAL_ONLY_ERROR, sortPlainObject, projectTournamentDbIdentity,
  MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS, getParticipantIds, queueMatchDiscordDeliveries, queueMatchParticipationCancellationDeliveries, getMatchPlayedIdMap, getSidePlayerRows, toAgreementRows, toApprovalRows,
  toAuthoritativeMatchRow, toAuthoritativePlayerStatRows, toDisputeRows, toResultRow, validateMatchCreateCourt, validateMatchRosterEligibility, validateMatchShape,
  validateResultShape, validateSoloRecordSnapshot, applyAuthoritativeMatchOperation, getOperation, loadAuthoritativeState,
};
