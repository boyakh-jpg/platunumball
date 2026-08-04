export const SETTINGS_PAGE_SOURCE_PATHS = [
  "src/pages/Settings.jsx",
  "src/pages/settingsPageModel.js",
  "src/pages/useSettingsPageController.jsx",
  "src/pages/useSettingsCourtRequestController.js",
  "src/pages/useSettingsFavorites.jsx",
  "src/pages/useSettingsRefereeController.js",
  "src/pages/useSettingsReportController.jsx",
  "src/pages/SettingsPageView.jsx",
  "src/pages/SettingsActivityDialog.jsx",
  "src/pages/SettingsPrimaryColumn.jsx",
  "src/pages/SettingsSideColumn.jsx",
  "src/pages/SettingsReportCard.jsx",
  "src/pages/SettingsRefereeSection.jsx",
];

export const ADMIN_PAGE_SOURCE_PATHS = [
  "src/pages/Admin.jsx",
  "src/pages/adminPageModel.js",
  "src/pages/AdminPageParts.jsx",
  "src/pages/useAdminPageController.jsx",
  "src/pages/AdminPageView.jsx",
  "src/pages/AdminAppointmentSection.jsx",
  "src/pages/AdminDetailPanel.jsx",
];

export const COURT_DATABASE_SOURCE_PATHS = [
  "src/components/admin/CourtDatabasePanel.jsx",
  "src/components/admin/courtDatabaseModel.js",
  "src/components/admin/CourtDatabaseControls.jsx",
  "src/components/admin/useCourtDatabasePanelController.js",
  "src/components/admin/CourtDatabasePanelView.jsx",
  "src/components/admin/CourtDatabaseDuplicateReview.jsx",
];

export const MATCHES_PAGE_SOURCE_PATHS = [
  "src/pages/Matches.jsx",
  "src/pages/matchesPageSelectors.js",
  "src/pages/matchesPageBaseSelectors.js",
  "src/pages/matchesPageModel.js",
  "src/pages/MatchesPagePanels.jsx",
  "src/pages/useMatchesPageController.jsx",
  "src/pages/MatchesPageView.jsx",
];

export const MATCH_ROOM_SOURCE_PATHS = [
  "src/pages/MatchRoom.jsx",
  "src/pages/matchRoomControllerParts.jsx",
  "src/pages/matchRoomModel.js",
  "src/pages/MatchRoomParts.jsx",
  "src/pages/MatchRoomView.jsx",
  "src/pages/MatchRoomReviewPanels.jsx",
  "src/pages/MatchRoomStatEditor.jsx",
];

export const MATCH_CLOCK_PANEL_SOURCE_PATHS = [
  "src/components/match/MatchClockPanel.jsx",
  "src/components/match/MatchClockPanelView.jsx",
  "src/components/match/MatchScoreControls.jsx",
];

export const TEAM_DETAIL_SOURCE_PATHS = [
  "src/pages/TeamDetail.jsx",
  "src/pages/TeamDetailView.jsx",
];

export const TOURNAMENT_DETAIL_SOURCE_PATHS = [
  "src/pages/TournamentDetail.jsx",
  "src/pages/tournamentDetailModel.jsx",
  "src/pages/TournamentDetailView.jsx",
  "src/pages/TournamentCompetitionSection.jsx",
];

export const HOME_PAGE_SOURCE_PATHS = [
  "src/pages/Home.jsx",
  "src/pages/HomePageView.jsx",
  "src/pages/useHomeSearchModel.jsx",
  "src/components/home/HomeRightRail.jsx",
  "src/lib/roomModalNavigation.js",
];

export const RECRUITING_PAGE_SOURCE_PATHS = [
  "src/pages/Recruiting.jsx",
  "src/pages/RecruitingPageView.jsx",
  "src/components/recruiting/RecruitingRoomModal.jsx",
  "src/components/recruiting/RecruitingRoomCore.jsx",
  "src/components/recruiting/RecruitingRoomSlotCore.jsx",
  "src/components/recruiting/RecruitingRoomPickerCore.jsx",
  "src/components/recruiting/RecruitingRoomCommandPanels.jsx",
  "src/components/recruiting/RecruitingRoomDependencies.js",
  "src/components/recruiting/RecruitingRoomActionFeedback.jsx",
  "src/components/recruiting/RecruitingRoomActionSection.jsx",
  "src/components/recruiting/RecruitingRoomDialogSection.jsx",
  "src/components/recruiting/RecruitingRoomLayout.jsx",
  "src/components/recruiting/RecruitingRoomManagementSection.jsx",
  "src/components/recruiting/RecruitingRoomMatchModel.jsx",
  "src/components/recruiting/RecruitingRoomMatchRenderers.jsx",
  "src/components/recruiting/RecruitingRoomPanels.jsx",
  "src/components/recruiting/RecruitingRoomRosterPanels.jsx",
  "src/components/recruiting/RecruitingRoomInvitePanels.jsx",
  "src/components/recruiting/RecruitingRoomPolicyModel.jsx",
  "src/components/recruiting/RecruitingRoomPrimarySection.jsx",
  "src/components/recruiting/RecruitingRoomRosterProps.js",
  "src/components/recruiting/RecruitingRoomSlotRenderers.jsx",
  "src/components/recruiting/RecruitingRoomStatusViews.jsx",
  "src/components/recruiting/RecruitingRoomView.jsx",
  "src/components/recruiting/RecruitingSourceMatchPanels.jsx",
  "src/components/recruiting/RoomManagementPanels.jsx",
  "src/components/recruiting/useRecruitingRoomController.js",
  "src/components/recruiting/useRecruitingRoomManagementActions.js",
  "src/components/recruiting/useRecruitingRoomModalInteractions.js",
  "src/components/recruiting/useRecruitingRoomParticipationActions.js",
  "src/lib/recruitingPage.js",
];

export const RECRUITING_STYLE_SOURCE_PATHS = [
  "src/styles/recruiting-arena.css",
  "src/styles/features/recruiting-room.css",
  "src/styles/themes/recruiting-arena-visual.css",
  "src/styles/layout/recruiting-arena-layout.css",
  "src/styles/responsive/recruiting-arena-responsive.css",
  "src/styles/themes/recruiting-slot-theme.css",
];

export const CREATE_MATCH_PAGE_SOURCE_PATHS = [
  "src/pages/CreateMatch.jsx",
  "src/components/match/CreateMatchActions.jsx",
  "src/components/match/CreateMatchCourtRosterSection.jsx",
  "src/components/match/CreateMatchDependencies.js",
  "src/components/match/CreateMatchDetailsSection.jsx",
  "src/components/match/CreateMatchFlow.jsx",
  "src/components/match/CreateMatchIntentSection.jsx",
  "src/components/match/CreateMatchLayout.jsx",
  "src/components/match/CreateMatchPolicyReviewSection.jsx",
  "src/components/match/CreateMatchRefereePicker.jsx",
  "src/components/match/CreateMatchView.jsx",
  "src/components/match/MatchCreationStepPanels.jsx",
  "src/components/match/useCreateMatchBaseController.js",
  "src/components/match/useCreateMatchValidationController.js",
  "src/lib/createMatchPage.js",
];

export const MATCH_SYNC_SOURCE_PATHS = [
  "server/api/matches/sync-match.js",
  "server/lib/matchSyncDependencies.js",
  "server/lib/matchSyncPolicy.js",
  "server/lib/matchSyncPolicyData.js",
  "server/lib/matchSqlActions.js",
  "server/lib/matchSqlCoreActions.js",
  "server/lib/matchSyncHandler.js",
];

export const RECRUITING_SYNC_SOURCE_PATHS = [
  "server/api/recruiting/sync-post.js",
  "server/api/recruiting/_syncPostActions.js",
  "server/api/recruiting/_syncPostChat.js",
  "server/api/recruiting/_syncPostCommon.js",
  "server/api/recruiting/_syncPostHandler.js",
  "server/api/recruiting/_syncPostManagementActions.js",
  "server/api/recruiting/_syncPostPersistence.js",
  "server/api/recruiting/_syncPostPickupPolicy.js",
  "server/api/recruiting/_syncPostPolicy.js",
  "server/api/recruiting/_syncPostProjection.js",
  "server/api/recruiting/_syncPostResponse.js",
];

export const RECRUITING_LIST_SOURCE_PATHS = [
  "server/api/recruiting/list.js",
  "server/api/recruiting/_listHandler.js",
  "server/api/recruiting/_listLoader.js",
  "server/api/recruiting/_listLoaderHelpers.js",
  "server/api/recruiting/_listProjection.js",
  "server/api/recruiting/_listProjectionCompact.js",
  "server/api/recruiting/_listQueries.js",
];

export const MATCH_LIST_SOURCE_PATHS = [
  "server/api/matches/list.js",
  "server/api/matches/_listEnrichment.js",
  "server/api/matches/_listFeedQueries.js",
  "server/api/matches/_listHandler.js",
  "server/api/matches/_listLoader.js",
  "server/api/matches/_listProjection.js",
  "server/api/matches/_listQueries.js",
];

export const SHARED_MATCH_SOURCE_PATHS = [
  "shared/lib/matchUtils.js",
  "shared/lib/matchAuthority.js",
  "shared/lib/matchConstants.js",
  "shared/lib/matchDecisionStatus.js",
  "shared/lib/matchDisputeRequests.js",
  "shared/lib/matchLegacyCompatibility.js",
  "shared/lib/matchLifecycleUtils.js",
  "shared/lib/matchListStore.js",
  "shared/lib/matchMappers.js",
  "shared/lib/matchParticipation.js",
  "shared/lib/matchPersistence.js",
  "shared/lib/matchPlayedDate.js",
  "shared/lib/matchReadProjection.js",
  "shared/lib/matchRecordTypes.js",
  "shared/lib/matchRecordVerification.js",
  "shared/lib/matchResultEntry.js",
  "shared/lib/matchRoomLifecycle.js",
  "shared/lib/matchRoster.js",
  "shared/lib/matchRosterSwap.js",
  "shared/lib/matchScheduleTime.js",
  "shared/lib/matchSummary.js",
  "shared/lib/matchTimeUtils.js",
];

export const REPOSITORY_RECRUITING_SOURCE_PATHS = [
  "src/data/repository/recruiting.js",
  "src/data/repository/recruiting/creation.js",
  "src/data/repository/recruiting/participation.js",
  "src/data/repository/recruiting/participationInterest.js",
  "src/data/repository/recruiting/participationRoster.js",
  "src/data/repository/recruiting/participationStatus.js",
  "src/data/repository/recruiting/invitations.js",
  "src/data/repository/recruiting/invitationPlayers.js",
  "src/data/repository/recruiting/invitationReferee.js",
  "src/data/repository/recruiting/invitationResponses.js",
  "src/data/repository/recruiting/party.js",
  "src/data/repository/recruiting/partyJoin.js",
  "src/data/repository/recruiting/partyPlacement.js",
  "src/data/repository/recruiting/partyRoster.js",
  "src/data/repository/recruiting/partyManagement.js",
  "src/data/repository/recruiting/confirmation.js",
];

export const REPOSITORY_MATCHES_SOURCE_PATHS = [
  "src/data/repository/matches.js",
  "src/data/repository/matches/result.js",
  "src/data/repository/matches/resultDisputes.js",
  "src/data/repository/matches/resultOperations.js",
  "src/data/repository/matches/resultSubmission.js",
  "src/data/repository/matches/lifecycle.js",
  "src/data/repository/matches/pickup.js",
  "src/data/repository/matches/feedback.js",
  "src/data/repository/matches/recordParticipants.js",
  "src/data/repository/matches/roster.js",
];

export const REPOSITORY_ROOM_RULES_SOURCE_PATHS = [
  "src/data/repository/roomRules.js",
  "src/data/repository/roomRules/helpers.js",
  "src/data/repository/roomRules/match.js",
  "src/data/repository/roomRules/proposals.js",
  "src/data/repository/roomRules/recruiting.js",
];

export const REPOSITORY_REMOTE_SOURCE_PATHS = [
  "src/data/repository/remote.js",
  "src/data/repository/remote/loaders.js",
  "src/data/repository/remote/state.js",
  "src/data/repository/remote/stateLoader.js",
  "src/data/repository/remote/stateScope.js",
  "src/data/repository/remote/seed.js",
];

export const APP_DATA_ACTION_SOURCE_PATHS = [
  "src/hooks/appData/actions.js",
  "src/hooks/appData/actions/loaderActions.js",
  "src/hooks/appData/actions/matchActions.js",
  "src/hooks/appData/actions/settingsActions.js",
  "src/hooks/appData/actions/profileTeamActions.js",
  "src/hooks/appData/actions/recruitingActions.js",
  "src/hooks/appData/actions/teamMembershipActions.js",
];

export const APP_DATA_ORCHESTRATOR_SOURCE_PATHS = [
  "src/hooks/appData/useAppDataOrchestrator.js",
  "src/hooks/appData/orchestrator/dependencySet.js",
  "src/hooks/appData/orchestrator/directoryLoaders.js",
  "src/hooks/appData/orchestrator/runtime.js",
  "src/hooks/appData/orchestrator/runtimeHydration.js",
  "src/hooks/appData/orchestrator/admin.js",
  "src/hooks/appData/orchestrator/serverActions.js",
  "src/hooks/appData/orchestrator/loaders.js",
  "src/hooks/appData/orchestrator/matchLoaders.js",
  "src/hooks/appData/orchestrator/recordLoaders.js",
];

export const APP_DATA_REMOTE_MERGE_SOURCE_PATHS = [
  "src/hooks/appData/remoteMerge.js",
  "src/hooks/appData/remoteMerge/entities.js",
  "src/hooks/appData/remoteMerge/pages.js",
  "src/hooks/appData/remoteMerge/results.js",
  "src/hooks/appData/remoteMerge/state.js",
];

export const ADMIN_LIB_SOURCE_PATHS = [
  "src/lib/admin.js",
  "src/lib/adminPolicy.js",
  "src/lib/adminAppointmentModel.js",
  "src/lib/adminReviewModel.js",
];

export async function readSourceGroup(readSource, paths) {
  return Promise.all(paths.map(readSource)).then((sources) => sources.join("\n"));
}

export function readSourceGroupSync(readSource, paths) {
  return paths.map(readSource).join("\n");
}
