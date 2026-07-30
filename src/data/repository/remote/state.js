import { ADMIN_AUDIT_COLUMNS } from "../../repositoryColumns.js";
import { ADMIN_DISCIPLINARY_COLUMNS } from "../../repositoryColumns.js";
import { AFFILIATION_COLUMNS } from "../../repositoryColumns.js";
import { APPOINTMENT_COLUMNS } from "../../repositoryColumns.js";
import { APPROVED_COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_REQUEST_COLUMNS } from "../../repositoryColumns.js";
import { COURT_REVIEW_COLUMNS } from "../../repositoryColumns.js";
import { DEFAULT_RATING } from "../../../lib/constants.js";
import { DEFAULT_SETTINGS } from "../../repositoryDefaults.js";
import { DEFAULT_TOURNAMENT_MMR_GAP } from "../../../lib/constants.js";
import { DISCORD_DELIVERY_COLUMNS } from "../../repositoryColumns.js";
import { FAVORITE_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_AGREEMENT_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_APPROVAL_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_DISPUTE_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_PLAYER_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_RESULT_COLUMNS } from "../../repositoryColumns.js";
import { NOTIFICATION_COLUMNS } from "../../repositoryColumns.js";
import { PLAYER_STAT_COLUMNS } from "../../repositoryColumns.js";
import { PRIVATE_PROFILE_COLUMNS } from "../../repositoryColumns.js";
import { PROFILE_SETTINGS_COLUMNS } from "../../repositoryColumns.js";
import { PUBLIC_PROFILE_COLUMNS } from "../../repositoryColumns.js";
import { RECRUITING_APPLICATION_COLUMNS } from "../../repositoryColumns.js";
import { RECRUITING_POST_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_EXAM_ATTEMPT_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_REQUEST_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../lib/constants.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../lib/constants.js";
import { REMOTE_CLIENT_TOURNAMENT_LIMIT } from "../../../lib/constants.js";
import { REPORT_COLUMNS } from "../../repositoryColumns.js";
import { SEASON_COLUMNS } from "../../repositoryColumns.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../../lib/constants.js";
import { TEAM_COLUMNS } from "../../repositoryColumns.js";
import { TEAM_INVITATION_COLUMNS } from "../../repositoryColumns.js";
import { TEAM_MEMBER_COLUMNS } from "../../repositoryColumns.js";
import { TEST_PROFILE_AGE_GROUP } from "../../../lib/constants.js";
import { TEST_PROFILE_AGE_GROUP_SEASON } from "../../../lib/constants.js";
import { TEST_PROFILE_BIRTH_YEAR } from "../../../lib/constants.js";
import { TEST_PROFILE_SETUP_AT } from "../../../lib/constants.js";
import { TOURNAMENT_COLUMNS } from "../../repositoryColumns.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { TOURNAMENT_TEAM_COLUMNS } from "../../repositoryColumns.js";
import { applyIdScope } from "../../remoteQuery.js";
import { applyUpdatedBefore } from "../../remoteQuery.js";
import { collectMatchPageScope } from "../../remoteScopeUtils.js";
import { collectRecruitingPageScope } from "../../remoteScopeUtils.js";
import { collectTournamentPageScope } from "../../remoteScopeUtils.js";
import { composeFilters } from "../../remoteQuery.js";
import { createProfileShell } from "../../profileMappers.js";
import { fetchAllRows } from "../../remoteQuery.js";
import { fetchFilteredRows } from "../../remoteQuery.js";
import { fetchOptionalFilteredRows } from "../../remoteQuery.js";
import { fetchOptionalRows } from "../../remoteQuery.js";
import { fetchRowsByIds } from "../../remoteQuery.js";
import { firstBy } from "../../rowUtils.js";
import { fromRemoteAffiliation } from "../../affiliationMappers.js";
import { fromRemoteApprovedCourt } from "../../remotePayloadMappers.js";
import { fromRemoteCourtMetric } from "../../remotePayloadMappers.js";
import { fromRemoteCourtRequest } from "../../remotePayloadMappers.js";
import { fromRemoteCourtReview } from "../../remotePayloadMappers.js";
import { fromRemoteMatch } from "../../matchMappers.js";
import { fromRemoteNotification } from "../../remotePayloadMappers.js";
import { fromRemotePayloadRow } from "../../remotePayloadMappers.js";
import { fromRemoteProfile } from "../../profileMappers.js";
import { fromRemoteReport } from "../../remotePayloadMappers.js";
import { fromRemoteTeam } from "../../teamMappers.js";
import { fromRemoteTeamInvitation } from "../../teamMappers.js";
import { fromRemoteTournament } from "../../tournamentMappers.js";
import { getClientLimit } from "../../remoteQuery.js";
import { getClientPrivateProfileFilter } from "../../remoteScopeUtils.js";
import { getCourtId } from "../../../lib/courts.js";
import { getDbScheduleParts } from "../../scheduleUtils.js";
import { getDiscordConnectionUserId } from "../../../lib/discord.js";
import { getMatchRowReaderIds } from "../../remoteScopeUtils.js";
import { getMaxUpdatedAt } from "../../rowUtils.js";
import { getProfileRegionSnapshot } from "../../profileMappers.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRemoteAppSettings } from "../../profileMappers.js";
import { getUserHashtag } from "../../../lib/handles.js";
import { groupBy } from "../../rowUtils.js";
import { isPublicTeamRecruitingRoom } from "../../../lib/recruiting.js";
import { isSupabaseConfigured } from "../../../lib/supabase.js";
import { makeCurrentUserFromProfiles } from "../../remoteScopeUtils.js";
import { mergePublicProfilesIntoProfiles } from "../../remoteScopeUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizeRatings } from "../../profileMappers.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { normalizeState } from "../../stateNormalizer.js";
import { nullableText } from "../../rowUtils.js";
import { projectMatchDbFields } from "../../../../shared/lib/matchPersistence.js";
import { projectPlayerStatRows } from "../../../../shared/lib/matchPersistence.js";
import { projectProfileSettings } from "../../settingsMappers.js";
import { replaceRemoteRecruitingApplications } from "../../remoteWriteUtils.js";
import { softDeleteRemoteTeams } from "../../remoteWriteUtils.js";
import { supabase } from "../../../lib/supabase.js";
import { toApprovedCourtRow } from "../../remoteRowSerializers.js";
import { toCourtRequestRow } from "../../remoteRowSerializers.js";
import { toDateTime } from "../../rowUtils.js";
import { toNotificationRow } from "../../remoteRowSerializers.js";
import { toPayloadRow } from "../../remoteRowSerializers.js";
import { toReportRow } from "../../remoteRowSerializers.js";
import { uniqueRowsById } from "../../remoteQuery.js";
import { uniqueScopeIds } from "../../remoteQuery.js";
import { upsertOptionalRemoteRows } from "../../remoteWriteUtils.js";
import { upsertRemoteRows } from "../../remoteWriteUtils.js";
import { fetchCourtRows, fetchCurrentUserReports } from "./loaders.js";
import { fetchScopedDirectoryReferences, mergeScopedProfiles } from "./stateScope.js";
import { loadNormalizedRemoteStateFromClient } from "./stateLoader.js";
export { loadNormalizedRemoteStateFromClient } from "./stateLoader.js";









async function loadNormalizedRemoteState(authUserId = "", authEmail = "", options = {}) {
  return loadNormalizedRemoteStateFromClient(supabase, authUserId, authEmail, options);
}

export async function loadRemoteState(authUserId = "", authEmail = "", options = {}) {
  if (!isSupabaseConfigured) return null;

  try {
    const normalizedRemote = await loadNormalizedRemoteState(authUserId, authEmail, { clientState: true, ...options });
    return normalizedRemote?.state ?? null;
  } catch (error) {
    console.warn("Supabase normalized state load failed. Remote state remains empty.", error.message);
    return null;
  }
}
