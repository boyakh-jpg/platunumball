// Stable compatibility boundary. Implementations live in responsibility-specific modules.

export { DEFAULT_SETTINGS } from "./repositoryDefaults.js";

export { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "./profileMappers.js";

export { fromRemoteTeamInvitation } from "./teamMappers.js";

export {
  hasDemoInitialState,
  normalizeState,
  setDemoInitialState,
} from "./stateNormalizer.js";

export {
  FAVORITE_LIMIT,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
  REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../lib/constants.js";

export {
  acceptTeamInvitation,
  cancelTeamInvitation,
  createTeam,
  declineTeamInvitation,
  deleteNotification,
  deleteTeam,
  inviteTeamMember,
  markAllNotificationsRead,
  markNotificationRead,
  removeTeamMember,
  updateProfile,
  updateTeamMemberRole,
} from "./repository/account.js";

export {
  approveCourtRequest,
  commitAdminAppointmentAction,
  commitAdminReviewAction,
} from "./repository/admin.js";

export {
  finishRefereeExamAttempt,
  startRefereeExamAttempt,
  submitCourtRequest,
  submitRefereeRequest,
} from "./repository/courts.js";

export {
  runAutomaticStateMaintenance,
} from "./repository/lifecycle.js";

export {
  loadState,
  resetState,
  saveState,
  subscribeRemoteState,
  syncNotificationDeliveries,
} from "./repository/localState.js";

export {
  createMatch,
} from "./repository/matchCreation.js";

export {
  agreeMatch,
  approveMatch,
  cancelMatch,
  checkInMatchPlayer,
  confirmMatchRefereeAbsence,
  confirmPickupSideAssignment,
  deleteSoloRecord,
  disputeMatch,
  endMatch,
  finalizeMatchByAuthority,
  generatePickupSideAssignment,
  incrementMatchScore,
  removeMatchRoomPlayer,
  requestMatchRefereeAbsence,
  resolveMatchDispute,
  setMatchRecordParticipants,
  setMatchRecordTeamRoster,
  setMatchRoomPlayerPlacement,
  startMatch,
  submitCourtReview,
  submitMatchResult,
  submitMatchThumbs,
  substituteMatchPlayer,
  swapPickupMatchPlayers,
  toggleMatchStar,
  voidMatch,
} from "./repository/matches.js";

export {
  acceptRecruitingInvitation,
  cancelRecruitingParticipation,
  closeRecruitingPost,
  confirmRecruitingMatch,
  createRecruitingPost,
  declineRecruitingInvitation,
  detachRecruitingPartyPlayer,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  inviteRecruitingReferee,
  joinRecruitingSideParty,
  kickRecruitingApplicant,
  removeRecruitingPartyPlayer,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingApplicantReserve,
  setRecruitingPartyPlayerPlacement,
  setRecruitingPartyPlayerReserve,
  setRecruitingReady,
  setRecruitingRoomTeam,
  setRecruitingSlotPosition,
  setRecruitingTeamPartyRoster,
} from "./repository/recruiting.js";

export {
  loadNormalizedDirectoryStateFromClient,
  loadNormalizedMatchDetailFromClient,
  loadNormalizedRemoteStateFromClient,
  loadRemoteState,
  saveNormalizedRemoteState,
  toSeedMatchRow,
  toSeedPlayerStatRows,
} from "./repository/remote.js";

export {
  reportCourt,
  reportCourtRequest,
  reportCourtReview,
  reportMatch,
  reportPlayer,
  reportTeamEmblem,
} from "./repository/reports.js";

export {
  acknowledgeMatchRoomRules,
  acknowledgeRecruitingRoomRules,
  respondMatchScheduleProposal,
  respondRecruitingScheduleProposal,
  updateMatchRoomRules,
  updateRecruitingRoomRules,
} from "./repository/roomRules.js";

export {
  configureServerRatingAuthority,
} from "./repository/runtime.js";
export {
  blockUser,
  toggleFavoriteCourt,
  toggleFavoritePlayer,
  toggleFavoriteReferee,
  toggleFavoriteTeam,
  unblockUser,
  updatePrivacySettings,
  updateSettings,
} from "./repository/settings.js";

export {
  activateTournamentSanction,
  approveTournamentReferee,
  approveTournamentTeam,
  assignTournamentMatchReferee,
  createTournament,
  declineTournamentReferee,
  forfeitTournamentMatch,
  inviteTournamentReferee,
  rejectTournamentRegion,
  updateTournamentMatchSchedule,
} from "./repository/tournaments.js";
