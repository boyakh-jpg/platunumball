import { ADMIN_AUDIT_COLUMNS, ADMIN_DISCIPLINARY_COLUMNS, AFFILIATION_COLUMNS, APPOINTMENT_COLUMNS, APPROVED_COURT_COLUMNS, COURT_COLUMNS, COURT_REQUEST_COLUMNS, COURT_REVIEW_COLUMNS, DISCORD_DELIVERY_COLUMNS, FAVORITE_COLUMNS, MATCH_AGREEMENT_COLUMNS, MATCH_APPROVAL_COLUMNS, MATCH_COLUMNS, MATCH_DISPUTE_COLUMNS, MATCH_PLAYER_COLUMNS, MATCH_RESULT_COLUMNS, NOTIFICATION_COLUMNS, PLAYER_STAT_COLUMNS, PRIVATE_PROFILE_COLUMNS, PROFILE_SETTINGS_COLUMNS, PUBLIC_PROFILE_COLUMNS, RECRUITING_APPLICATION_COLUMNS, RECRUITING_POST_COLUMNS, REFEREE_EXAM_ATTEMPT_COLUMNS, REFEREE_REQUEST_COLUMNS, REPORT_COLUMNS, SEASON_COLUMNS, TEAM_COLUMNS, TEAM_INVITATION_COLUMNS, TEAM_MEMBER_COLUMNS, TOURNAMENT_COLUMNS, TOURNAMENT_TEAM_COLUMNS } from "../../repositoryColumns.js";
import { DEFAULT_RATING, DEFAULT_TOURNAMENT_MMR_GAP, REFEREE_TRUST_MIN, REMOTE_CLIENT_MATCH_LIMIT, REMOTE_CLIENT_RECRUITING_LIMIT, REMOTE_CLIENT_TOURNAMENT_LIMIT, STAT_ENTRY_WINDOW_MINUTES, TEST_PROFILE_AGE_GROUP, TEST_PROFILE_AGE_GROUP_SEASON, TEST_PROFILE_BIRTH_YEAR, TEST_PROFILE_SETUP_AT, normalizeDisputeWindowMinutes, normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { DEFAULT_SETTINGS } from "../../repositoryDefaults.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { applyIdScope, applyUpdatedBefore, composeFilters, fetchAllRows, fetchFilteredRows, fetchOptionalFilteredRows, fetchOptionalRows, fetchRowsByIds, getClientLimit, uniqueRowsById, uniqueScopeIds } from "../../remoteQuery.js";
import { collectMatchPageScope, collectRecruitingPageScope, collectTournamentPageScope, getClientPrivateProfileFilter, getMatchRowReaderIds, makeCurrentUserFromProfiles, mergePublicProfilesIntoProfiles } from "../../remoteScopeUtils.js";
import { createProfileShell, fromRemoteProfile, getProfileRegionSnapshot, getRemoteAppSettings, normalizeRatings } from "../../profileMappers.js";
import { firstBy, getMaxUpdatedAt, groupBy, nullableText, toDateTime } from "../../rowUtils.js";
import { fromRemoteAffiliation } from "../../affiliationMappers.js";
import { fromRemoteApprovedCourt, fromRemoteCourtMetric, fromRemoteCourtRequest, fromRemoteCourtReview, fromRemoteNotification, fromRemotePayloadRow, fromRemoteReport } from "../../remotePayloadMappers.js";
import { fromRemoteMatch } from "../../matchMappers.js";
import { fromRemoteTeam, fromRemoteTeamInvitation } from "../../teamMappers.js";
import { fromRemoteTournament } from "../../tournamentMappers.js";
import { getCourtId } from "../../../lib/courts.js";
import { getDbScheduleParts } from "../../scheduleUtils.js";
import { getDiscordConnectionUserId } from "../../../lib/discord.js";
import { getRecruitingBenchCapacity, getRecruitingRoomOwnerId, getRecruitingSideCapacity, isPublicTeamRecruitingRoom, normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getUserHashtag } from "../../../lib/handles.js";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase.js";
import { normalizeState } from "../../stateNormalizer.js";
import { projectMatchDbFields, projectPlayerStatRows } from "../../../../shared/lib/matchPersistence.js";
import { projectProfileSettings } from "../../settingsMappers.js";
import { replaceRemoteRecruitingApplications, softDeleteRemoteTeams, upsertOptionalRemoteRows, upsertRemoteRows } from "../../remoteWriteUtils.js";
import { toApprovedCourtRow, toCourtRequestRow, toNotificationRow, toPayloadRow, toReportRow } from "../../remoteRowSerializers.js";
import { fetchCourtRows, fetchCurrentUserReports } from "./loaders.js";

export async function fetchScopedDirectoryReferences(client, {
  teamIds = [],
  teamMemberTeamIds = teamIds,
  courtIds = [],
  profileIds = [],
} = {}) {
  const [teams, teamMembers, courts] = await Promise.all([
    fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client),
    fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamMemberTeamIds, null, client),
    fetchCourtRows(client, courtIds),
  ]);
  const publicProfiles = await fetchRowsByIds(
    "public_profiles",
    PUBLIC_PROFILE_COLUMNS,
    "id",
    [...profileIds, ...teamMembers.map((member) => member.user_id)],
    "id",
    client,
    true,
  );
  return { teams, teamMembers, courts, publicProfiles };
}

export function mergeScopedProfiles(profiles, publicProfiles, privateProfileById) {
  publicProfiles.forEach((profile) => {
    const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
    const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
    if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
    else profiles.push(mergedProfile);
  });
}
