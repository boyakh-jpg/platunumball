import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createPortal,
} from "react-dom";
import {
  useNavigate,
} from "react-router-dom";
import {
  Clock3,
  Copy,
  Crown,
  MapPin,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Swords,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import EmptyState from "../common/EmptyState.jsx";
import NumericStepper from "../common/NumericStepper.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import CourtHoverCard from "../court/CourtHoverCard.jsx";
import ApprovalPanel from "../match/ApprovalPanel.jsx";
import MatchDisputeQueue from "../match/MatchDisputeQueue.jsx";
import {
  MatchScoreControls,
} from "../match/MatchClockPanel.jsx";
import MatchAttendanceQrPanel from "../match/MatchAttendanceQrPanel.jsx";
import {
  MatchOperationsPolicyFields,
} from "../match/MatchCreationWizard.jsx";
import MmrRangeSelector from "../match/MmrRangeSelector.jsx";
import MatchRecommendationPanel from "../match/MatchRecommendationPanel.jsx";
import PickupParticipantPool from "../match/PickupParticipantPool.jsx";
import RoomPhaseRenderer from "../match/RoomPhaseRenderer.jsx";
import {
  MatchFinalizeDialog,
} from "../match/MatchVoidDialog.jsx";
import MeetingPointFields from "../match/MeetingPointFields.jsx";
import RuleSelector from "../match/RuleSelector.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import RefereeHoverCard from "../referee/RefereeHoverCard.jsx";
import {
  MatchRecordRosterPanel,
  MatchSubstitutionPanel,
  RoomKickPanel,
} from "../recruiting/RoomManagementPanels.jsx";
import MatchRecordParticipantSetupPanel from "../recruiting/MatchRecordParticipantSetupPanel.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";
import {
  getTeamCaptainMemberId as getTeamCaptainId,
} from "../../data/teamMappers.js";
import {
  getTournamentRosterTeam,
} from "../../data/tournamentMappers.js";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import {
  DEFAULT_RATING,
  MATCH_MODES,
  MATCH_SIDES,
  MAX_RECRUITING_RESERVES_PER_SIDE as MAX_RESERVE_PLAYERS_PER_SIDE,
  PLAYER_POSITIONS,
  PLAYER_STAT_FIELDS,
  SIDE_LABEL_TEXT as SIDE_LABELS,
} from "../../lib/constants.js";
import {
  getCourtLayoutLabel,
  getCourtPlayWarning,
  getCourtSurfaceLabel,
  getRegisteredCourts,
} from "../../lib/courts.js";
import {
  MMR_RANGE_POLICIES,
  RECRUITING_JOIN_MODES,
  getRecruitingBenchCapacity,
  getRecruitingFit,
  getRecruitingLobby,
  getRecruitingRoomOwnerId,
  getRecruitingPostTerminalState,
  getRecruitingSideCapacity,
  getRecruitingTargetMmr,
  getRecruitingTierRange,
  getTeamEventEligibility,
  isIndividualOnlyRecruitingRoom,
  isSyntheticMatchRoomId,
  isTeamOnlyRecruitingRoom as isTeamOnlyRoom,
  isPaidRecruitingCourt,
  isPickupRecruitingRoom,
} from "../../lib/recruiting.js";
import {
  getTeamHashtag,
} from "../../lib/handles.js";
import {
  getLinkedPersonalRecordDisplayUser,
} from "../../lib/personalRecordRoster.js";
import {
  getRecruitingPartyPlayerIds as getPartyPlayerIds,
  getRecruitingPartyReserveIds as getPartyReserveIds,
} from "../../lib/teamPartyRoster.js";
import {
  isTournamentGovernanceEnabled,
} from "../../lib/tournamentGovernance.js";
import {
  BRAND_NAME,
} from "../../lib/brand.js";
import {
  isSupabaseConfigured,
} from "../../lib/supabase.js";
import {
  MATCH_DISPUTE_REASON_OPTIONS,
  OTHER_MATCH_DISPUTE_REASON,
  buildMatchDisputeRequest,
  canUserResolveMatchDispute,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomVisibilityLabel,
  getMatchCancelCopy,
  getMatchRecordCompositionLabel,
  getOpenMatchDisputes,
  getMatchRecordPlayerIds,
  getMatchResultEntryPermission,
  getMatchRecordWindow,
  getMatchManualFinalizationStatus,
  getMatchResultRevision,
  getMatchRoomPhase,
  getMatchReservePlayerIds,
  getMatchSideLeaderId,
  getMatchSidePlayerIds,
  getTournamentMatchDisplayTitle,
  getPublicRoomTimingStatus,
  getRoomScheduleLabel,
  isEligibleReferee,
  isMatchReferee,
  isMatchRecordMatch,
  isMatchRoomChatLocked,
  isMatchSideTeamParty,
  isPersonalRecordMatch,
  isTournamentMatchLineupEditable,
} from "../../lib/matchUtils.js";
import {
  getMatchRuleDetailRows,
  getMatchRuleInputValidation,
  getMatchRuleSummary,
  getMeetingPointSummary,
  normalizeMatchRules,
} from "../../lib/matchRules.js";
import {
  PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS,
  getMatchCreationSummary,
  getRoomRemakeDraft,
} from "../../lib/matchCreationPolicies.js";
import {
  ROOM_BODY_MODES,
  getPickupOpenSlotPlacements,
  getPickupParticipantIds,
  getPickupRerollState,
  getPickupResizeValidation,
  getPickupTeamAssignmentPolicy,
  getPostgameRecordVerification,
  getRecruitingRuleAcknowledgement,
  getRoomCancellationActionLabel,
  getRoomCancellationPolicy,
  getRoomEditAvailability,
  getRoomPhaseViewModel,
  getRoomScheduleProposalProgress,
  isMatchPregameSlotManagementOpen,
  isMatchRecordParticipantSetupOpen,
  isMatchRecordParticipantSetupRequired,
  isRoomScheduleChangePending,
} from "../../lib/roomFlow.js";
import {
  DIRECTORY_PICKER_PAGE_LIMIT,
} from "../../lib/queryPolicy.js";
import {
  getUnsafeUserTextReason,
  UNSAFE_INPUT_MESSAGE,
} from "../../lib/inputSecurity.js";
import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH as CHAT_MESSAGE_MAX_LENGTH,
  ROOM_CHAT_RATE_LIMIT as CHAT_RATE_LIMIT,
  ROOM_CHAT_RATE_WINDOW_MS as CHAT_RATE_WINDOW_MS,
  ROOM_CHAT_REPEAT_BLOCK_MS as CHAT_REPEAT_BLOCK_MS,
  ROOM_CHAT_SEND_COOLDOWN_MS as CHAT_SEND_COOLDOWN_MS,
} from "../../lib/roomChat.js";
import {
  copyTextToClipboard,
  getDefaultApplyTeamId,
  getDefaultJoinDraft,
  getDefaultJoinRoster,
  getJoinActiveCapacity,
  getJoinReserveCapacity,
  getPlayerMmrAverage,
  getRecruitingDisplayTitle,
  getRoomEditDraft,
  getRoomEditSaveError,
  getRoomShareUrl,
  getRoomTitleSizeClass,
} from "../../lib/recruitingPage.js";
import {
  getEntryMmr,
  getLobbySideMeta,
  getRoomSlotDisplayPosition,
  getPartyOptionLabel,
  getPartyOptionKey,
  getEntryPartyLeaderId,
  getRecruitingSideLeaderId,
  getRoomSlotBadge,
  getMissingStartAttendanceIds,
  canMovePlayerTo,
  getEntryPlayerReserveState,
  getSameSidePartyOptions,
  getJoinableSidePartyOptions,
  isPartyEntry,
  getLobbyPrimaryTeamId,
  PlayerRoomSlot,
  isCurrentUserRoomParticipant,
  getRecruitingRoomStatus,
  TeamMemberPicker,
  SlotCommandPanel,
  SelfSlotCommandPanel,
} from "./RecruitingRoomCore.jsx";
import {
  SideRoster,
  ReserveLine,
  RoomChat,
  InvitePanel,
  RefereeInvitePanel,
  InvitationPanel,
} from "./RecruitingRoomPanels.jsx";
import {
  getSourceMatchDecisionSideName,
  getSourceMatchStatus,
  getSourceMatchAction,
  SourceMatchDisputeReviewPanel,
  SourceMatchRecordSummary,
  SourceMatchDisputeEditor,
  SourceMatchDisputeControls,
} from "./RecruitingSourceMatchPanels.jsx";

export const RECRUITING_ROOM_DEPENDENCIES = {
  useCallback, useEffect, useMemo, useRef, useState, createPortal,
  useNavigate, Clock3, Copy, Crown, MapPin, RefreshCw,
  RotateCcw, Share2, ShieldCheck, Swords, UserRound, UsersRound,
  X, XCircle, Badge, BasketballLoader, Button, EmptyState,
  NumericStepper, SearchPicker, CourtHoverCard, ApprovalPanel, MatchDisputeQueue, MatchScoreControls,
  MatchAttendanceQrPanel, MatchOperationsPolicyFields, MmrRangeSelector, MatchRecommendationPanel, PickupParticipantPool, RoomPhaseRenderer,
  MatchFinalizeDialog, MeetingPointFields, RuleSelector, PlayerHoverCard, ProfileEmblem, RefereeHoverCard,
  MatchRecordRosterPanel, MatchSubstitutionPanel, RoomKickPanel, MatchRecordParticipantSetupPanel, TierBadge, TeamEmblem,
  TeamHoverCard, getTeamCaptainId, getTournamentRosterTeam, useBodyScrollLock, DEFAULT_RATING, MATCH_MODES,
  MATCH_SIDES, MAX_RESERVE_PLAYERS_PER_SIDE, PLAYER_POSITIONS, PLAYER_STAT_FIELDS, SIDE_LABELS, getCourtLayoutLabel,
  getCourtPlayWarning, getCourtSurfaceLabel, getRegisteredCourts, MMR_RANGE_POLICIES, RECRUITING_JOIN_MODES, getRecruitingBenchCapacity,
  getRecruitingFit, getRecruitingLobby, getRecruitingRoomOwnerId, getRecruitingPostTerminalState, getRecruitingSideCapacity, getRecruitingTargetMmr,
  getRecruitingTierRange, getTeamEventEligibility, isIndividualOnlyRecruitingRoom, isSyntheticMatchRoomId, isTeamOnlyRoom, isPaidRecruitingCourt,
  isPickupRecruitingRoom, getTeamHashtag, getLinkedPersonalRecordDisplayUser, getPartyPlayerIds, getPartyReserveIds, isTournamentGovernanceEnabled,
  BRAND_NAME, isSupabaseConfigured, MATCH_DISPUTE_REASON_OPTIONS, OTHER_MATCH_DISPUTE_REASON, buildMatchDisputeRequest, canUserResolveMatchDispute,
  getRoomCompetitionLabel, getRoomRefereeLabel, getRoomVisibilityLabel, getMatchCancelCopy, getMatchRecordCompositionLabel, getOpenMatchDisputes,
  getMatchRecordPlayerIds, getMatchResultEntryPermission, getMatchRecordWindow, getMatchManualFinalizationStatus, getMatchResultRevision, getMatchRoomPhase,
  getMatchReservePlayerIds, getMatchSideLeaderId, getMatchSidePlayerIds, getTournamentMatchDisplayTitle, getPublicRoomTimingStatus, getRoomScheduleLabel,
  isEligibleReferee, isMatchReferee, isMatchRecordMatch, isMatchRoomChatLocked, isMatchSideTeamParty, isPersonalRecordMatch,
  isTournamentMatchLineupEditable, getMatchRuleDetailRows, getMatchRuleInputValidation, getMatchRuleSummary, getMeetingPointSummary, normalizeMatchRules,
  PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS, getMatchCreationSummary, getRoomRemakeDraft, ROOM_BODY_MODES, getPickupOpenSlotPlacements, getPickupParticipantIds,
  getPickupRerollState, getPickupResizeValidation, getPickupTeamAssignmentPolicy, getPostgameRecordVerification, getRecruitingRuleAcknowledgement, getRoomCancellationActionLabel,
  getRoomCancellationPolicy, getRoomEditAvailability, getRoomPhaseViewModel, getRoomScheduleProposalProgress, isMatchPregameSlotManagementOpen, isMatchRecordParticipantSetupOpen, isMatchRecordParticipantSetupRequired,
  isRoomScheduleChangePending, DIRECTORY_PICKER_PAGE_LIMIT, getUnsafeUserTextReason, UNSAFE_INPUT_MESSAGE, CHAT_MESSAGE_MAX_LENGTH, CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS, CHAT_REPEAT_BLOCK_MS, CHAT_SEND_COOLDOWN_MS, copyTextToClipboard, getDefaultApplyTeamId, getDefaultJoinDraft,
  getDefaultJoinRoster, getJoinActiveCapacity, getJoinReserveCapacity, getPlayerMmrAverage, getRecruitingDisplayTitle, getRoomEditDraft,
  getRoomEditSaveError, getRoomShareUrl, getRoomTitleSizeClass, getEntryMmr, getLobbySideMeta, getRoomSlotDisplayPosition,
  getPartyOptionLabel, getPartyOptionKey, getEntryPartyLeaderId, getRecruitingSideLeaderId, getRoomSlotBadge, getMissingStartAttendanceIds,
  canMovePlayerTo, getEntryPlayerReserveState, getSameSidePartyOptions, getJoinableSidePartyOptions, isPartyEntry, getLobbyPrimaryTeamId,
  PlayerRoomSlot, isCurrentUserRoomParticipant, getRecruitingRoomStatus, TeamMemberPicker, SlotCommandPanel, SelfSlotCommandPanel,
  SideRoster, ReserveLine, RoomChat, InvitePanel, RefereeInvitePanel, InvitationPanel,
  getSourceMatchDecisionSideName, getSourceMatchStatus, getSourceMatchAction, SourceMatchDisputeReviewPanel, SourceMatchRecordSummary, SourceMatchDisputeEditor, SourceMatchDisputeControls,
};
