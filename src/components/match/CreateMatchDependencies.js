import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, Globe2, Lock, Map as MapIcon, MapPin, ShieldCheck, Star, Trophy, UsersRound, X } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import NumericStepper from "../common/NumericStepper.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import CourtDetailModal from "../court/CourtDetailModal.jsx";
import CourtMapPicker from "../court/CourtMapPicker.jsx";
import MeetingPointFields from "./MeetingPointFields.jsx";
import MmrRangeSelector from "./MmrRangeSelector.jsx";
import {
  MatchCostPolicyFields,
  MatchCreationWizardActions,
  MatchCreationWizardNav,
  MatchIntentPresetSelector,
  MatchOperationsPolicyFields,
  MatchRosterPolicyFields,
  getMatchCreationSteps,
} from "./MatchCreationWizard.jsx";
import {
  MatchCreationReviewPanel,
  MatchCreationRulePanel,
} from "./MatchCreationStepPanels.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";
import { DEFAULT_RATING, DEFAULT_TOURNAMENT_MMR_GAP, DISPUTE_WINDOW_MINUTES, MATCH_MODES, MAX_RECRUITING_RESERVES_PER_SIDE as MAX_PARTY_RESERVES, PLAYER_STAT_FIELDS, RECORD_TYPES, REFEREE_ACTIVE_TRUST_MIN, REFEREE_TRUST_MIN, REGIONS, ROOM_SCHEDULE_MAX_DAYS, SCHEDULE_MAX_DAYS, SOLO_RECORD_MODE_IDS, getCanonicalRegion, getHostTrustRequirement, getModeSize, getRoomKindFromDraft, getRoomKindLabel, isSameRegion } from "../../lib/constants.js";
import { getCourtAddress, getCourtLayoutLabel, getCourtPickerResults, getCourtPlayWarning, getCourtRecommendationScore, getCourtSearchText, getCourtSurfaceLabel, getRegisteredCourts, isCourtInRegion, mergeCourtSearchCourts } from "../../lib/courts.js";
import { getCourtHashtag, getTeamHashtag, getUserHashtag } from "../../lib/handles.js";
import { addDateDays, getLocalDateInputValue, getPublicRoomMaxDateInput, getPublicRoomTimingStatus, getRecordCreationWindowStatus, getSeoulTimeInputValue, isEligibleReferee } from "../../lib/matchUtils.js";
import { getMatchRulesPayload } from "../../lib/matchRules.js";
import {
  getSoloRecordPlayerRef,
  getSoloRecordRosterError,
  getSoloRecordRosterLines,
  getSoloRecordSelectedIdentitySet,
  getSoloRecordUserIdentity,
  getSoloRecordUserLine,
  getSoloRecordUserSearchText,
  normalizeSoloRecordRosterInput,
} from "../../lib/personalRecordRoster.js";
import { getNextQueueSchedule } from "../../data/scheduleUtils.js";
import {
  RECORD_COMPOSITION_OPTIONS,
  RECORD_ENTRY_MODE_OPTIONS,
  getDefaultMatchCreationPolicy,
  getMatchConfigurationChangePatch,
  getMatchFormationMode,
  getRecordComposition,
  getRecordEntryMode,
  getMatchCreationPolicyPayload,
  getMatchCreationValidation,
  getMatchCreationWizardType,
  getMatchIntentChangePatch,
  getMatchModeChangePatch,
  getPersonalRecordDraftPayload,
  getRoomRemakeDraft,
  getRoomRemakeWarningCopy,
  getScopedMatchCreationPolicyPayload,
} from "../../lib/matchCreationPolicies.js";
import { AGE_GROUPS, REGION_TREE, getAgeGroupForUser, getLoginPath, getRepresentativeTeam, inferRegionSelection } from "../../lib/profileSetup.js";
import { COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE, DIRECTORY_PICKER_PAGE_LIMIT } from "../../lib/queryPolicy.js";
import { MMR_RANGE_POLICIES, getRecruitingSideCapacity, getRecruitingTierRange, getSelectableTeamPlayerIds, getTeamEventEligibility, isMmrInRecruitingRange, normalizeRecruitingMmrRangeMode } from "../../lib/recruiting.js";
import { getClientActionAccessToken, postServerAction } from "../../lib/serverActions.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import {
  getCreateDefaultTeamPlayerIds as getDefaultTeamPlayerIds,
  getCreatePartyPlayerIds as getPartyPlayerIds,
  getCreatePartyReserveIds as getPartyReserveIds,
} from "../../lib/teamPartyRoster.js";
import {
  getRequiredTournamentRefereeCount,
  getTournamentRefereePoolValidation,
} from "../../lib/tournamentGovernance.js";
import {
  DEFAULT_MATCH_MEMO,
  MATCH_MODE_IDS,
  formatCreateSaveError,
  getAgeRestrictionOption,
  getAvailableTeamPlayerIds,
  getCreateStepFromSearch,
  getCreateStepSearch,
  getDefaultCreateMode,
  getDefaultCreateTitle,
  getDefaultMmrLimitMode,
  getDefaultTournamentTitle,
  getMatchModeOrDefault,
  getMatchRecordMemo,
  getMmrSpread,
  getOpponentTeam,
  hydrateCreateMatchTeam,
  getRepresentativePlayerIds,
  getTeamChallengeEligibilityPolicy,
  clearCreateMatchGuestDraft,
  getCreateMatchGuestDraft,
  includesQuery,
  isDefaultCreateTitle,
  isDefaultTournamentTitle,
  isHashtagQuery,
  makeEmptySoloStats,
  saveCreateMatchGuestDraft,
  mmrLimitOptions,
  toggleAgeRestriction,
  tournamentFormatOptions,
  tournamentMmrPolicyOptions,
  tournamentScheduleOptions,
} from "../../lib/createMatchPage.js";

const SOLO_RECORD_MODES = Array.from(SOLO_RECORD_MODE_IDS, (id) => ({ id, label: id }));

export const CREATE_MATCH_DEPENDENCIES = {
  useCallback, useEffect, useMemo, useRef, useState, useLocation,
  useNavigate, ClipboardList, Globe2, Lock, MapIcon, MapPin,
  ShieldCheck, Star, Trophy, UsersRound, X, Badge,
  Button, Card, NumericStepper, SearchPicker, CourtDetailModal, CourtMapPicker,
  MeetingPointFields, MmrRangeSelector, MatchCostPolicyFields, MatchCreationWizardActions, MatchCreationWizardNav, MatchIntentPresetSelector,
  MatchOperationsPolicyFields, MatchRosterPolicyFields, getMatchCreationSteps, MatchCreationReviewPanel, MatchCreationRulePanel, TeamHoverCard,
  DEFAULT_RATING, DEFAULT_TOURNAMENT_MMR_GAP, DISPUTE_WINDOW_MINUTES, MATCH_MODES, MAX_PARTY_RESERVES, PLAYER_STAT_FIELDS,
  RECORD_TYPES, REFEREE_ACTIVE_TRUST_MIN, REFEREE_TRUST_MIN, REGIONS, ROOM_SCHEDULE_MAX_DAYS, SCHEDULE_MAX_DAYS, SOLO_RECORD_MODE_IDS,
  getCanonicalRegion, getHostTrustRequirement, getModeSize, getRoomKindFromDraft, getRoomKindLabel, isSameRegion,
  getCourtAddress, getCourtLayoutLabel, getCourtPickerResults, getCourtPlayWarning, getCourtRecommendationScore, getCourtSearchText,
  getCourtSurfaceLabel, getRegisteredCourts, isCourtInRegion, mergeCourtSearchCourts, getCourtHashtag, getTeamHashtag,
  getUserHashtag, addDateDays, getLocalDateInputValue, getPublicRoomMaxDateInput, getPublicRoomTimingStatus, getRecordCreationWindowStatus,
  getSeoulTimeInputValue, isEligibleReferee, getMatchRulesPayload, getSoloRecordPlayerRef, getSoloRecordRosterError, getSoloRecordRosterLines,
  getSoloRecordSelectedIdentitySet, getSoloRecordUserIdentity, getSoloRecordUserLine, getSoloRecordUserSearchText, normalizeSoloRecordRosterInput, getNextQueueSchedule,
  RECORD_COMPOSITION_OPTIONS, RECORD_ENTRY_MODE_OPTIONS, getDefaultMatchCreationPolicy, getMatchConfigurationChangePatch, getMatchFormationMode, getRecordComposition,
  getRecordEntryMode, getMatchCreationPolicyPayload, getMatchCreationValidation, getMatchCreationWizardType, getMatchIntentChangePatch, getMatchModeChangePatch,
  getPersonalRecordDraftPayload, getRoomRemakeDraft, getRoomRemakeWarningCopy, getScopedMatchCreationPolicyPayload, AGE_GROUPS, REGION_TREE,
  getAgeGroupForUser, getRepresentativeTeam, inferRegionSelection, COURT_MAP_SEARCH_LIMIT, COURT_MAP_SEARCH_PURPOSE, DIRECTORY_PICKER_PAGE_LIMIT,
  MMR_RANGE_POLICIES, getRecruitingSideCapacity, getRecruitingTierRange, getSelectableTeamPlayerIds, getTeamEventEligibility, isMmrInRecruitingRange,
  normalizeRecruitingMmrRangeMode, postServerAction, getClientActionAccessToken, getLoginPath, isSupabaseConfigured,
  getDefaultTeamPlayerIds, getPartyPlayerIds, getPartyReserveIds, getRequiredTournamentRefereeCount,
  getTournamentRefereePoolValidation, DEFAULT_MATCH_MEMO, MATCH_MODE_IDS, formatCreateSaveError, getAgeRestrictionOption, getAvailableTeamPlayerIds,
  getCreateStepFromSearch, getCreateStepSearch, getDefaultCreateMode, getDefaultCreateTitle, getDefaultMmrLimitMode, getDefaultTournamentTitle,
  getMatchModeOrDefault, getMatchRecordMemo, getMmrSpread, getOpponentTeam, hydrateCreateMatchTeam, getRepresentativePlayerIds, getTeamChallengeEligibilityPolicy,
  clearCreateMatchGuestDraft, getCreateMatchGuestDraft, includesQuery, isDefaultCreateTitle, isDefaultTournamentTitle, isHashtagQuery,
  makeEmptySoloStats, saveCreateMatchGuestDraft, mmrLimitOptions, toggleAgeRestriction,
  tournamentFormatOptions, tournamentMmrPolicyOptions, tournamentScheduleOptions, SOLO_RECORD_MODES,
};
