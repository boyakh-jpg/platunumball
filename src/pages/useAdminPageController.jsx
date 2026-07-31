import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ADMIN_REVIEW_ACTIONS, buildAdminAppointmentModel, buildAdminReviewModel, getAdminActionTargetUserIds, getAdminReviewMetrics, isHighImpactAdminReviewAction } from "../lib/admin.js";
import { getCourtCorrectionPatch, getCourtFacilityBaseName, getCourtLocationMatches, getCourtMapUrl, getCourtStandardName, normalizeCourtSourceUrl } from "../lib/courts.js";
import { ADMIN_DEFAULT_PAGE_LIMIT, DEFAULT_ADMIN_QUEUE_MODE, DEFAULT_ADMIN_SECTION } from "../lib/queryPolicy.js";
import { getTeamEmblemErrorMessage } from "../lib/teamEmblem.js";
import {
  ADMIN_SECTION_OPTIONS,
  ACTION_OPTIONS,
  REVIEW_WORKFLOW_COPY,
  isPendingCourtRequest,
} from "./adminPageModel.js";

export default function useAdminPageController({
  app
}) {
const [searchParams, setSearchParams] = useSearchParams();
  const adminLevel = Number(app.adminContext?.level ?? 0);
  const canOwner = adminLevel >= 100;
  const sectionOptions = ADMIN_SECTION_OPTIONS.filter((option) => (
    (!option.ownerOnly || canOwner) && (!option.minLevel || adminLevel >= option.minLevel)
  ));
  const requestedSection = searchParams.get("section");
  const section = sectionOptions.some((option) => option.id === requestedSection) ? requestedSection : DEFAULT_ADMIN_SECTION;
  const view = ["appointments", "ratingPolicy", "userOps", "courtDb"].includes(section) ? "courts" : section;
  const [queueModeState, setQueueModeState] = useState({ section: DEFAULT_ADMIN_SECTION, value: DEFAULT_ADMIN_QUEUE_MODE });
  const queueMode = queueModeState.section === section ? queueModeState.value : DEFAULT_ADMIN_QUEUE_MODE;
  const setQueueMode = (value) => setQueueModeState({ section, value });
  const [queueFilterByView, setQueueFilterByView] = useState({});
  const [appliedQueueFilterByView, setAppliedQueueFilterByView] = useState({});
  const queueFilter = queueFilterByView[section] ?? "";
  const appliedQueueFilter = appliedQueueFilterByView[section] ?? "";
  const loadAdminSection = app.actions.loadAdminSection;
  useEffect(() => {
    if (["ratingPolicy", "userOps", "courtDb"].includes(section)) return;
    loadAdminSection?.({ section, queueMode, filter: appliedQueueFilter, limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0 });
  }, [appliedQueueFilter, loadAdminSection, queueMode, section]);
  const [selectedIdByView, setSelectedIdByView] = useState({});
  const [selectedReportIdByScope, setSelectedReportIdByScope] = useState({});
  const [actionDraft, setActionDraft] = useState({
    actionType: "validReport",
    penaltyType: "",
    durationDays: 3,
    targetUserId: "",
    replacementName: "",
    mergeTargetId: "",
    reason: "",
    feedback: "",
  });
  const [mergeAffiliationQuery, setMergeAffiliationQuery] = useState("");
  const [appointmentDraft, setAppointmentDraft] = useState({
    actionType: "appointReferee",
    userId: "",
    adminGrade: "support",
    refereeGrade: "candidate",
    termDays: 90,
    appointmentId: "",
    reason: "",
  });
  const [appointmentUserQuery, setAppointmentUserQuery] = useState("");
  const [appointmentUserSnapshot, setAppointmentUserSnapshot] = useState(null);
  const [courtApprovalDraft, setCourtApprovalDraft] = useState({
    approvedName: "",
    addressVerified: false,
    multipleCourtsVerified: false,
  });
  const [courtApprovalStatus, setCourtApprovalStatus] = useState("");
  const [reviewActionStatus, setReviewActionStatus] = useState("");
  const [reviewActionPending, setReviewActionPending] = useState(false);
  const [reviewActionConfirming, setReviewActionConfirming] = useState(false);
  const [appointmentActionPending, setAppointmentActionPending] = useState(false);
  const [appointmentActionStatus, setAppointmentActionStatus] = useState("");
  const canAdmin = adminLevel >= 30;
  const adminViewState = app.adminState ?? app.state;
  const model = useMemo(() => buildAdminReviewModel(adminViewState), [adminViewState]);
  const appointments = useMemo(() => buildAdminAppointmentModel(adminViewState), [adminViewState]);
  const appointmentUsers = useMemo(
    () => {
      const usersById = new Map((adminViewState.users ?? []).map((user) => [user.id, user]));
      if (appointmentUserSnapshot?.id) usersById.set(appointmentUserSnapshot.id, appointmentUserSnapshot);
      return [...usersById.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    [adminViewState.users, appointmentUserSnapshot],
  );
  const activeAppointmentOptions = useMemo(
    () => appointments.rows.filter((row) => row.active && row.source !== "current_profile" && row.source !== "server_context"),
    [appointments.rows],
  );
  const reviewRows = useMemo(() => {
    const rows = model[view] ?? [];
    if (view === "courts") {
      return rows.filter((row) => row.courtRequestCount > 0 || row.reportCount > 0 || row.courtReviewCount > 0);
    }
    if (view === "matches") {
      return rows.filter((row) => row.reportCount > 0 || row.issueCount > 0);
    }
    return rows;
  }, [model, view]);
  const pendingRows = useMemo(() => reviewRows.filter((row) => {
    if (view === "courts") return row.openCount > 0 || row.courtRequests.some(isPendingCourtRequest);
    if (view === "matches") return row.issueCount > 0;
    return row.openCount > 0;
  }), [reviewRows, view]);
  const activeRows = queueMode === "history" ? reviewRows : pendingRows;
  const selectedId = selectedIdByView[view];
  const selectedRow = activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
  const reportOptions = selectedRow?.reports ?? [];
  const selectedReportScope = `${view}:${selectedRow?.id ?? ""}`;
  const selectedReportId = selectedReportIdByScope[selectedReportScope] ?? "";
  const userMap = useMemo(() => Object.fromEntries((adminViewState.users ?? []).map((user) => [user.id, user])), [adminViewState.users]);
  const matchMap = useMemo(() => Object.fromEntries((adminViewState.matches ?? []).map((match) => [match.id, match])), [adminViewState.matches]);
  const selectedReport = reportOptions.find((report) => report.id === selectedReportId) ?? reportOptions.find((report) => report.status === "open") ?? reportOptions[0] ?? null;
  const selectedMatch = selectedRow?.match ?? matchMap[selectedReport?.sourceMatchId] ?? null;
  const selectedReportIsVoidRestore = selectedReport?.matchReviewType === "void_restore";
  const selectedCourtRequest = selectedRow?.courtRequests?.find(isPendingCourtRequest)
    ?? selectedRow?.courtRequests?.[0]
    ?? null;
  const selectedCourtRequester = selectedCourtRequest ? userMap[selectedCourtRequest.requestedBy] : null;
  const courtLocationMatches = useMemo(
    () => selectedCourtRequest
      ? getCourtLocationMatches(selectedCourtRequest, adminViewState, { excludeRequestId: selectedCourtRequest.id })
      : [],
    [adminViewState, selectedCourtRequest],
  );
  const approvedLocationMatches = courtLocationMatches.filter((candidate) => candidate.type === "approved");
  const courtMapHref = selectedCourtRequest ? getCourtMapUrl(selectedCourtRequest) : "";
  const courtSourceHref = selectedCourtRequest ? normalizeCourtSourceUrl(selectedCourtRequest.sourceUrl) : "";
  const courtApprovalPreview = selectedCourtRequest ? getCourtStandardName({
    ...selectedCourtRequest,
    facilityName: courtApprovalDraft.approvedName,
    name: courtApprovalDraft.approvedName,
  }) : "";
  const workflow = REVIEW_WORKFLOW_COPY[view] ?? REVIEW_WORKFLOW_COPY.players;
  const sectionCounts = useMemo(() => {
    const courtReports = (adminViewState.reports ?? []).filter((report) => (
      report.status === "open" && ["court", "court_review"].includes(report.type)
    )).length;
    const localCounts = {
      courts: (adminViewState.settings?.courtRequests ?? []).filter(isPendingCourtRequest).length + courtReports,
      courtDb: "",
      players: model.players.filter((row) => row.openCount > 0).length,
      userOps: "",
      matches: model.matches.filter((row) => row.issueCount > 0).length,
      teams: model.teams.filter((row) => row.openCount > 0).length,
      appointments: appointments.summary.pendingAppointmentCount,
      ratingPolicy: "",
    };
    return Object.fromEntries(Object.entries(localCounts).map(([key, value]) => [
      key,
      ["ratingPolicy", "userOps", "courtDb"].includes(key) ? "" : app.adminStatus?.counts?.[key] ?? (key === section ? value : ""),
    ]));
  }, [adminViewState.reports, adminViewState.settings?.courtRequests, app.adminStatus?.counts, appointments.summary.pendingAppointmentCount, model.matches, model.players, model.teams, section]);
  const activeAdminPage = app.adminStatus?.section === section && app.adminStatus?.queueMode === queueMode
    ? app.adminStatus.page
    : null;
  const activeQueueTotal = activeRows.length;
  const changeSection = (nextSection) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", nextSection);
    setSearchParams(next);
  };
  const applyQueueFilter = () => {
    setAppliedQueueFilterByView((current) => ({ ...current, [section]: queueFilter.trim() }));
  };
  const updateQueueFilter = (value) => {
    setQueueFilterByView((current) => ({ ...current, [section]: value }));
  };
  const clearQueueFilter = () => {
    setQueueFilterByView((current) => ({ ...current, [section]: "" }));
    setAppliedQueueFilterByView((current) => ({ ...current, [section]: "" }));
  };
  const refreshQueue = () => loadAdminSection?.({
    section,
    queueMode,
    filter: appliedQueueFilter,
    limit: ADMIN_DEFAULT_PAGE_LIMIT,
    offset: 0,
    force: true,
  });
  const visibleActionOptions = useMemo(() => {
    if (selectedReportIsVoidRestore) {
      return adminLevel >= 50 ? ACTION_OPTIONS.filter((option) => ["keepMatchVoid", "restoreMatchHalf", "restoreMatchFull"].includes(option.id)) : [];
    }
    if (selectedReport?.type === "court" && selectedReport.courtCorrection?.field === "duplicate") {
      const ids = adminLevel >= 50
        ? ["markCourtDuplicate", "dismissReport", "hideCourt", "maliciousReporter"]
        : ["dismissReport"];
      return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
    }
    if (selectedReport?.type === "court" && getCourtCorrectionPatch(selectedReport.courtCorrection)) {
      const ids = adminLevel >= 50
        ? ["applyCourtCorrection", "dismissReport", "hideCourt", "maliciousReporter"]
        : ["dismissReport"];
      return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
    }
    if (selectedReport?.type === "team_emblem") {
      const ids = adminLevel >= 50 ? ["resetTeamEmblem", "dismissReport", "maliciousReporter"] : ["dismissReport"];
      return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
    }
    if (selectedReport?.type === "team_name") {
      const ids = adminLevel >= 50 ? ["renameTeam", "dismissReport", "maliciousReporter"] : ["dismissReport"];
      return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
    }
    if (selectedReport?.type === "affiliation_name") {
      const ids = adminLevel >= 50 ? ["renameAffiliation", "mergeAffiliation", "dismissReport", "maliciousReporter"] : ["dismissReport"];
      return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
    }
    const ids = ["validReport", "dismissReport"];
    if (adminLevel >= 50) {
      ids.push("maliciousReporter");
      if (selectedReport?.type === "court") ids.push("hideCourt");
      if (selectedReport?.type === "court_review") ids.push("hideCourtReview");
      if (getAdminActionTargetUserIds(selectedReport, "suspendTarget", selectedMatch).length) ids.push("suspendTarget");
      if (getAdminActionTargetUserIds(selectedReport, "refereeDiscipline", selectedMatch).length) ids.push("refereeDiscipline");
    }
    return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
  }, [adminLevel, selectedMatch, selectedReport, selectedReportIsVoidRestore]);
  const actionTargetUserIds = useMemo(
    () => getAdminActionTargetUserIds(
      selectedReport,
      selectedReportIsVoidRestore && actionDraft.penaltyType ? "suspendTarget" : actionDraft.actionType,
      selectedMatch,
    ),
    [actionDraft.actionType, actionDraft.penaltyType, selectedMatch, selectedReport, selectedReportIsVoidRestore],
  );
  const targetCandidates = useMemo(() => {
    return actionTargetUserIds.map((userId) => userMap[userId]).filter(Boolean);
  }, [actionTargetUserIds, userMap]);
  const selectedTargetUserId = targetCandidates.some((user) => user.id === actionDraft.targetUserId)
    ? actionDraft.targetUserId
    : targetCandidates[0]?.id ?? "";
  const actionNeedsTarget = ["maliciousReporter", "suspendTarget", "refereeDiscipline"].includes(actionDraft.actionType)
    || (selectedReportIsVoidRestore && Boolean(actionDraft.penaltyType));
  const actionTargetIsReporter = actionDraft.actionType === "maliciousReporter";
  const actionNeedsReplacementName = ["renameTeam", "renameAffiliation"].includes(actionDraft.actionType);
  const actionNeedsMergeTarget = actionDraft.actionType === "mergeAffiliation";
  const nameModerationAction = actionNeedsReplacementName || actionNeedsMergeTarget;
  const nameModerationInvalid = (actionNeedsReplacementName && !actionDraft.replacementName.trim())
    || (actionNeedsMergeTarget && !actionDraft.mergeTargetId);
  const reviewReasonMaxLength = actionDraft.actionType === "markCourtDuplicate" ? 160 : 500;
  const reviewActionInvalid = actionDraft.reason.trim().length < 4
    || actionDraft.feedback.trim().length < 4
    || actionDraft.reason.trim().length > reviewReasonMaxLength
    || actionDraft.feedback.trim().length > 500
    || (actionNeedsTarget && !selectedTargetUserId)
    || nameModerationInvalid;
  const reviewActionHighImpact = isHighImpactAdminReviewAction(actionDraft.actionType);
  const reviewMetrics = selectedRow ? getAdminReviewMetrics(view, selectedRow) : [];
  const selectedNeedsAction = Boolean(
    selectedRow && (
      selectedRow.openCount > 0 ||
      (view === "courts" && selectedRow.courtRequests.some(isPendingCourtRequest)) ||
      (view === "matches" && selectedRow.issueCount > 0)
    )
  );

  useEffect(() => {
    setReviewActionStatus("");
    setReviewActionConfirming(false);
    setActionDraft((current) => {
      const nextActionType = visibleActionOptions.some((option) => option.id === current.actionType)
        ? current.actionType
        : visibleActionOptions[0]?.id ?? "validReport";
      return {
        ...current,
        actionType: nextActionType,
        penaltyType: "",
        targetUserId: "",
        replacementName: selectedRow?.team?.name ?? selectedRow?.affiliation?.name ?? "",
        mergeTargetId: "",
        reason: ADMIN_REVIEW_ACTIONS[nextActionType]?.reason ?? "",
        feedback: ADMIN_REVIEW_ACTIONS[nextActionType]?.feedback ?? "",
      };
    });
    setMergeAffiliationQuery("");
  }, [selectedReport?.id, selectedRow?.affiliation?.name, selectedRow?.id, selectedRow?.team?.name, visibleActionOptions]);

  useEffect(() => {
    setCourtApprovalDraft({
      approvedName: selectedCourtRequest ? getCourtFacilityBaseName(
        selectedCourtRequest.facilityName || selectedCourtRequest.baseName || selectedCourtRequest.name,
        selectedCourtRequest.sigungu,
        selectedCourtRequest.courtUnit,
      ) : "",
      addressVerified: false,
      multipleCourtsVerified: false,
    });
    setCourtApprovalStatus("");
  }, [selectedCourtRequest?.id, selectedCourtRequest?.name]);

  const updateActionDraft = (patch) => setActionDraft((current) => ({ ...current, ...patch }));
  const changeReviewActionType = (actionType) => {
    setReviewActionConfirming(false);
    setReviewActionStatus("");
    updateActionDraft({
      actionType,
      targetUserId: "",
      reason: ADMIN_REVIEW_ACTIONS[actionType]?.reason ?? "",
      feedback: ADMIN_REVIEW_ACTIONS[actionType]?.feedback ?? "",
    });
  };
  const updateAppointmentDraft = (patch) => setAppointmentDraft((current) => ({ ...current, ...patch }));
  const selectAppointmentUser = (user) => {
    if (!user?.id) return;
    setAppointmentUserSnapshot(user);
    setAppointmentUserQuery(user.name ?? user.handle ?? user.hashtag ?? user.id);
    updateAppointmentDraft({ userId: user.id });
  };
  const changeAppointmentUserQuery = (value) => {
    setAppointmentUserQuery(value);
    const selectedLabel = appointmentUserSnapshot?.name
      ?? appointmentUserSnapshot?.handle
      ?? appointmentUserSnapshot?.hashtag
      ?? appointmentUserSnapshot?.id
      ?? "";
    if (value === selectedLabel) return;
    setAppointmentUserSnapshot(null);
    updateAppointmentDraft({ userId: "" });
  };
  const updateCourtApprovalDraft = (patch) => setCourtApprovalDraft((current) => ({ ...current, ...patch }));
  const approveSelectedCourt = async () => {
    if (!selectedCourtRequest) return;
    setCourtApprovalStatus("승인 중");
    const result = await app.actions.approveCourtRequest(selectedCourtRequest.id, courtApprovalDraft);
    setCourtApprovalStatus(result && result.ok !== false ? "승인되었습니다." : "승인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };
  const commitSelectedAction = async () => {
    if (!selectedReport || reviewActionPending) return;
    if (reviewActionInvalid) {
      setReviewActionStatus("처리 사유와 신고자 안내를 각각 4자 이상 입력하고 대상을 확인해 주세요.");
      return;
    }
    setReviewActionPending(true);
    setReviewActionStatus("처리 중");
    try {
      const result = await app.actions.commitAdminReviewAction({
        ...actionDraft,
        targetUserId: selectedTargetUserId,
        reportId: selectedReport.id,
      });
      if (!result || result.ok === false) {
        setReviewActionStatus(result?.error === "report_already_processed"
          ? "이미 다른 관리자가 처리했습니다. 최신 목록으로 갱신했습니다."
          : selectedReport.type === "team_emblem"
          ? getTeamEmblemErrorMessage(result?.error || "admin_review_action_failed")
          : "관리자 처리를 완료하지 못했습니다.");
      } else if (result.storageCleanupPending) {
        setReviewActionStatus("엠블럼은 기본값으로 전환되었습니다. 이전 사진 정리는 잠시 후 다시 확인해 주세요.");
      } else {
        setReviewActionStatus("처리가 완료되었습니다.");
      }
    } catch (error) {
      setReviewActionStatus(selectedReport.type === "team_emblem"
        ? getTeamEmblemErrorMessage(error?.code || error?.message)
        : "관리자 처리를 완료하지 못했습니다.");
    } finally {
      setReviewActionPending(false);
      setReviewActionConfirming(false);
    }
  };
  const commitAppointmentAction = async () => {
    if (appointmentActionPending) return;
    const appointmentId = ["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType)
      ? appointmentDraft.appointmentId || activeAppointmentOptions[0]?.id || ""
      : "";
    setAppointmentActionPending(true);
    setAppointmentActionStatus("저장 중");
    try {
      const result = await app.actions.commitAdminAppointmentAction({
        ...appointmentDraft,
        userId: appointmentDraft.userId,
        appointmentId,
      });
      setAppointmentActionStatus(!result || result.ok === false ? "처리하지 못했습니다." : "처리했습니다.");
    } catch {
      setAppointmentActionStatus("처리하지 못했습니다.");
    } finally {
      setAppointmentActionPending(false);
    }
  };
  return {
    app,
    adminLevel,
    sectionOptions,
    section,
    view,
    queueMode,
    setQueueMode,
    queueFilter,
    appliedQueueFilter,
    loadAdminSection,
    setSelectedIdByView,
    setSelectedReportIdByScope,
    actionDraft,
    mergeAffiliationQuery,
    setMergeAffiliationQuery,
    appointmentDraft,
    appointmentUserQuery,
    setAppointmentUserQuery: changeAppointmentUserQuery,
    appointmentUserSnapshot,
    courtApprovalDraft,
    courtApprovalStatus,
    reviewActionStatus,
    reviewActionPending,
    reviewActionConfirming,
    setReviewActionConfirming,
    appointmentActionPending,
    appointmentActionStatus,
    canAdmin,
    adminViewState,
    appointments,
    appointmentUsers,
    activeAppointmentOptions,
    activeRows,
    selectedRow,
    reportOptions,
    selectedReportScope,
    userMap,
    matchMap,
    selectedReport,
    selectedReportIsVoidRestore,
    selectedCourtRequest,
    selectedCourtRequester,
    courtLocationMatches,
    approvedLocationMatches,
    courtMapHref,
    courtSourceHref,
    courtApprovalPreview,
    workflow,
    sectionCounts,
    activeAdminPage,
    activeQueueTotal,
    changeSection,
    applyQueueFilter,
    updateQueueFilter,
    clearQueueFilter,
    refreshQueue,
    visibleActionOptions,
    targetCandidates,
    selectedTargetUserId,
    actionNeedsTarget,
    actionTargetIsReporter,
    actionNeedsReplacementName,
    actionNeedsMergeTarget,
    nameModerationAction,
    reviewReasonMaxLength,
    reviewActionInvalid,
    reviewActionHighImpact,
    reviewMetrics,
    selectedNeedsAction,
    updateActionDraft,
    changeReviewActionType,
    updateAppointmentDraft,
    selectAppointmentUser,
    updateCourtApprovalDraft,
    approveSelectedCourt,
    commitSelectedAction,
    commitAppointmentAction,
  };
}
