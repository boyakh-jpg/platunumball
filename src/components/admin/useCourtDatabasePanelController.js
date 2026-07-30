import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_COLUMN_WIDTH,
  DEFAULT_COURT_FILTERS,
  EMPTY_HISTORY_FILTERS,
  COURT_COLUMNS,
  HISTORY_COLUMNS,
  formatValue,
  buildRowDraft,
  buildPatch,
  isColumnEditable,
  getDraftCourtName,
  validatePatch,
  getSaveErrorMessage,
} from "./courtDatabaseModel.js";

export default function useCourtDatabasePanelController({
  app
}) {
const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("courts");
  const [courtRows, setCourtRows] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [courtPage, setCourtPage] = useState({ page: 1, pageSize: 100, total: 0, pageCount: 1 });
  const [historyPage, setHistoryPage] = useState({ page: 1, pageSize: 100, total: 0, pageCount: 1 });
  const [courtFilterDraft, setCourtFilterDraft] = useState(DEFAULT_COURT_FILTERS);
  const [historyFilterDraft, setHistoryFilterDraft] = useState(EMPTY_HISTORY_FILTERS);
  const [courtQuery, setCourtQuery] = useState({ page: 1, sortKey: "reviewPriority", sortDirection: "asc", filters: DEFAULT_COURT_FILTERS });
  const [historyQuery, setHistoryQuery] = useState({ page: 1, sortKey: "createdAt", sortDirection: "desc", filters: EMPTY_HISTORY_FILTERS });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [draftRows, setDraftRows] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [reason, setReason] = useState("");
  const [reasonOptional, setReasonOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [proximityReview, setProximityReview] = useState(null);
  const [proximityLoading, setProximityLoading] = useState(false);
  const [actualCourtCount, setActualCourtCount] = useState("");
  const [duplicateReview, setDuplicateReview] = useState(null);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateActualCount, setDuplicateActualCount] = useState("");
  const requestRef = useRef(0);
  const proximityRequestRef = useRef(0);
  const duplicateRequestRef = useRef(0);

  const activeColumns = tab === "courts" ? COURT_COLUMNS : HISTORY_COLUMNS;
  const activeQuery = tab === "courts" ? courtQuery : historyQuery;
  const activeDraft = tab === "courts" ? courtFilterDraft : historyFilterDraft;
  const activePage = tab === "courts" ? courtPage : historyPage;
  const tableWidth = activeColumns.reduce((total, column) => total + Number.parseInt(column.width, 10), 0) + (tab === "courts" ? ACTION_COLUMN_WIDTH : 0);
  const dirtyUpdates = useMemo(() => Object.entries(draftRows).flatMap(([courtId, draft]) => {
    const patch = buildPatch(draft);
    return Object.keys(patch).length ? [{ courtId, patch, ...draft }] : [];
  }), [draftRows]);
  const editDirty = dirtyUpdates.length > 0;
  const dirtyFieldCount = useMemo(() => dirtyUpdates.reduce((total, update) => total + Object.keys(update.patch).length, 0), [dirtyUpdates]);
  const editValidation = useMemo(() => {
    for (const update of dirtyUpdates) {
      const row = courtRows.find((candidate) => candidate.id === update.courtId);
      const message = validatePatch(update.values, update.patch);
      if (message) return `${row?.name ?? update.courtId}: ${message}`;
    }
    return "";
  }, [courtRows, dirtyUpdates]);
  const activeRow = useMemo(() => courtRows.find((row) => row.id === activeCell?.courtId) ?? null, [courtRows, activeCell?.courtId]);
  const reviewRow = reviewMode ? courtRows[reviewIndex] ?? null : null;
  const selectedRow = activeRow ?? reviewRow;
  const reviewPosition = reviewRow
    ? ((Number(courtPage.page ?? 1) - 1) * Number(courtPage.pageSize ?? 100)) + reviewIndex + 1
    : 0;
  const activeRowDraft = activeRow ? draftRows[activeRow.id] : null;
  const activeEditedName = activeRow && activeRowDraft ? getDraftCourtName(activeRow, activeRowDraft.values) : "";
  const activeNameDirty = Boolean(activeRow && activeEditedName && activeEditedName !== activeRow.name);
  const reviewDraft = reviewRow ? draftRows[reviewRow.id] : null;
  const reviewValues = reviewRow ? (reviewDraft?.values ?? buildRowDraft(reviewRow)) : null;
  const reviewPatch = buildPatch(reviewDraft);
  const reviewEditedName = reviewRow && reviewValues ? getDraftCourtName(reviewRow, reviewValues) : "";
  const reviewValidation = reviewRow && reviewValues ? validatePatch(reviewValues, reviewPatch, true) : "";
  const reviewUsesCurrentFacility = reviewRow?.name_evidence_application_status === "skipped_manual";
  const reviewEvidenceDecision = reviewUsesCurrentFacility
    ? "주소·수동명 우선"
    : formatValue({ type: "nameEvidenceDecision" }, reviewRow?.name_evidence_decision);
  const reviewEvidenceReference = reviewUsesCurrentFacility
    ? reviewValues?.facilityName || reviewRow?.facility_name || "-"
    : reviewRow?.name_evidence_reference || "-";
  const duplicateGroup = duplicateReview?.groups?.[duplicateReview.index] ?? null;
  const duplicateDetectedCount = Number(duplicateGroup?.detectedCount ?? 0);
  const duplicateDisplayCourts = duplicateGroup?.courts ?? [];
  const reasonValid = reasonOptional || reason.trim().length >= 4;

  const loadRows = async (preserveStatus = false) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    if (!preserveStatus) setStatus("");
    const result = tab === "courts"
      ? await app.actions.loadAdminCourtDatabase?.(courtQuery)
      : await app.actions.loadAdminCourtNameHistory?.(historyQuery);
    if (requestRef.current !== requestId) return null;
    setLoading(false);
    if (!result || result.ok === false) {
      setStatus("목록을 불러오지 못했습니다.");
      return result ?? null;
    }
    if (tab === "courts") {
      setCourtRows(result.rows ?? []);
      setCourtPage(result.page ?? { page: 1, pageSize: 100, total: 0, pageCount: 1 });
      setReasonOptional(result.capabilities?.reasonOptional === true);
    } else {
      setHistoryRows(result.rows ?? []);
      setHistoryPage(result.page ?? { page: 1, pageSize: 100, total: 0, pageCount: 1 });
    }
    return result;
  };

  useEffect(() => {
    if (!open) return;
    void loadRows();
    // Query objects only change on explicit filter, sort, or page actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, courtQuery, historyQuery]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!reviewMode) return;
    if (!courtRows.length) {
      setActiveCell(null);
      return;
    }
    const safeIndex = Math.min(reviewIndex, courtRows.length - 1);
    if (safeIndex !== reviewIndex) {
      setReviewIndex(safeIndex);
      return;
    }
    const row = courtRows[safeIndex];
    setActiveCell((current) => (
      current?.courtId === row.id ? current : { courtId: row.id, patchKey: "facilityName" }
    ));
  }, [courtRows, reviewIndex, reviewMode]);

  useEffect(() => {
    const courtId = reviewRow?.id;
    if (!reviewMode || !courtId) {
      setProximityReview(null);
      setActualCourtCount("");
      return undefined;
    }
    const requestId = proximityRequestRef.current + 1;
    proximityRequestRef.current = requestId;
    setProximityLoading(true);
    setProximityReview(null);
    void app.actions.loadAdminCourtProximity?.({ courtId, facilityName: reviewRow.facility_name }).then((result) => {
      if (proximityRequestRef.current !== requestId) return;
      setProximityLoading(false);
      if (!result || result.ok === false) {
        setStatus(getSaveErrorMessage(result?.error));
        return;
      }
      setProximityReview(result);
      setActualCourtCount(String(result.actualCount ?? result.detectedCount ?? 1));
      const groupedCourts = new Map((result.courts ?? []).map((court) => [court.id, court]));
      setCourtRows((current) => current.map((row) => {
        const grouped = groupedCourts.get(row.id);
        return grouped ? {
          ...row,
          name: grouped.name ?? row.name,
          facility_name: grouped.facilityName ?? row.facility_name,
          court_unit: grouped.courtUnit ?? row.court_unit,
          status: grouped.status ?? row.status,
        } : row;
      }));
    });
    return () => { proximityRequestRef.current += 1; };
    // A new court id is the only trigger. Row refreshes must not create another audit event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode, reviewRow?.id]);

  const clearDraftEdits = () => {
    setDraftRows({});
    setActiveCell(null);
  };
  const resetEdits = () => {
    clearDraftEdits();
    setReason("");
  };
  const canDiscard = () => !saving && (!editDirty || window.confirm("저장하지 않은 수정값을 버릴까요?"));
  const closeModal = () => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewMode(false);
    duplicateRequestRef.current += 1;
    setDuplicateReview(null);
    setDuplicateLoading(false);
    setOpen(false);
  };
  const changeTab = (nextTab) => {
    if (nextTab === tab || !canDiscard()) return;
    resetEdits();
    setReviewMode(false);
    duplicateRequestRef.current += 1;
    setDuplicateReview(null);
    setDuplicateLoading(false);
    setStatus("");
    setTab(nextTab);
  };
  const changeFilter = (key, value) => {
    if (tab === "courts") setCourtFilterDraft((current) => ({ ...current, [key]: value }));
    else setHistoryFilterDraft((current) => ({ ...current, [key]: value }));
  };
  const applyFilters = () => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewIndex(0);
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page: 1, filters: { ...courtFilterDraft } }));
    else setHistoryQuery((current) => ({ ...current, page: 1, filters: { ...historyFilterDraft } }));
  };
  const resetFilters = () => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewIndex(0);
    if (tab === "courts") {
      setCourtFilterDraft({ ...DEFAULT_COURT_FILTERS });
      setCourtQuery((current) => ({ ...current, page: 1, sortKey: "reviewPriority", sortDirection: "asc", filters: { ...DEFAULT_COURT_FILTERS } }));
    } else {
      setHistoryFilterDraft({ ...EMPTY_HISTORY_FILTERS });
      setHistoryQuery((current) => ({ ...current, page: 1, sortKey: "createdAt", sortDirection: "desc", filters: { ...EMPTY_HISTORY_FILTERS } }));
    }
  };
  const changeSort = (key) => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewIndex(0);
    const update = (current) => ({
      ...current,
      page: 1,
      sortKey: key,
      sortDirection: current.sortKey === key && current.sortDirection === "asc" ? "desc" : "asc",
    });
    if (tab === "courts") setCourtQuery(update);
    else setHistoryQuery(update);
  };
  const changePage = (page) => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewIndex(0);
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page }));
    else setHistoryQuery((current) => ({ ...current, page }));
  };
  const updateDraftValues = (row, valuePatch) => setDraftRows((current) => {
    const existing = current[row.id];
    const original = existing?.original ?? buildRowDraft(row);
    const values = { ...(existing?.values ?? original), ...valuePatch };
    const nextDraft = { original, values };
    if (Object.keys(buildPatch(nextDraft)).length) return { ...current, [row.id]: nextDraft };
    const next = { ...current };
    delete next[row.id];
    return next;
  });
  const activateCell = (row, column) => {
    if (!isColumnEditable(row, column) || saving) return;
    setActiveCell({ courtId: row.id, patchKey: column.patchKey });
    setStatus("");
  };
  const updateEditValue = (row, patchKey, value) => updateDraftValues(row, { [patchKey]: value });
  const updateReviewValue = (patchKey, value) => {
    if (!reviewRow || saving) return;
    const valuePatch = { [patchKey]: value };
    if (patchKey === "accessType") {
      valuePatch.reservationRequired = value === "reservation" ? true : value === "walk_in" ? false : null;
    }
    updateDraftValues(reviewRow, valuePatch);
    setStatus("");
  };
  const restoreCell = (row, patchKey) => {
    const original = draftRows[row.id]?.original ?? buildRowDraft(row);
    updateDraftValues(row, { [patchKey]: original[patchKey] });
  };
  const applyQuickStatus = (kind) => {
    if (!selectedRow || saving) return;
    if (kind === "review") updateDraftValues(selectedRow, { verificationStatus: "review_required", operationalStatus: "pending", status: "hidden" });
    else if (kind === "disabled") updateDraftValues(selectedRow, { status: "disabled" });
    else updateDraftValues(selectedRow, { status: "active" });
  };

  const startReview = () => {
    if (!courtRows.length || !canDiscard()) return;
    resetEdits();
    setReviewIndex(0);
    setCourtQuery((current) => (
      current.page === 1 && current.sortKey === "reviewPriority" && current.sortDirection === "asc"
        ? current
        : { ...current, page: 1, sortKey: "reviewPriority", sortDirection: "asc" }
    ));
    setReviewMode(true);
    setStatus("현재 필터 결과를 1개씩 검수합니다.");
  };

  const stopReview = () => {
    if (!canDiscard()) return;
    resetEdits();
    setReviewMode(false);
    setReviewIndex(0);
    setStatus("");
  };

  const moveReview = (direction) => {
    if (!reviewMode || saving || loading) return;
    if (editDirty) {
      setStatus("현재 구장의 수정값을 저장하거나 전체 취소한 뒤 이동해 주세요.");
      return;
    }
    const nextIndex = reviewIndex + direction;
    if (nextIndex >= 0 && nextIndex < courtRows.length) {
      setReviewIndex(nextIndex);
      setStatus("");
      return;
    }
    const currentPage = Number(courtPage.page ?? 1);
    const pageCount = Number(courtPage.pageCount ?? 1);
    if (direction > 0 && currentPage < pageCount) {
      setReviewIndex(0);
      setCourtQuery((current) => ({ ...current, page: currentPage + 1 }));
      return;
    }
    if (direction < 0 && currentPage > 1) {
      setReviewIndex(99);
      setCourtQuery((current) => ({ ...current, page: currentPage - 1 }));
      return;
    }
    setStatus(direction > 0 ? "현재 필터 결과의 마지막 구장입니다." : "현재 필터 결과의 첫 구장입니다.");
  };

  const advanceReviewAfterSave = (savedCourtId, refreshedResult) => {
    const rows = refreshedResult?.rows ?? [];
    const refreshedPage = refreshedResult?.page ?? courtPage;
    const savedIndex = rows.findIndex((row) => row.id === savedCourtId);
    if (savedIndex < 0 && rows.length) {
      setReviewIndex(Math.min(reviewIndex, rows.length - 1));
      return;
    }
    if (savedIndex >= 0 && savedIndex + 1 < rows.length) {
      setReviewIndex(savedIndex + 1);
      return;
    }
    const currentPage = Number(refreshedPage.page ?? 1);
    const pageCount = Number(refreshedPage.pageCount ?? 1);
    if (currentPage < pageCount) {
      setReviewIndex(0);
      setCourtQuery((current) => ({ ...current, page: currentPage + 1 }));
      return;
    }
    setReviewIndex(Math.max(0, rows.length - 1));
    setStatus("현재 필터 결과의 검수가 끝났습니다.");
  };

  const commitReview = async (scenario, successMessage) => {
    const row = reviewRow;
    if (!row || saving) return;
    const draft = reviewDraft ?? { original: buildRowDraft(row), values: reviewValues };
    const patch = buildPatch(draft);
    const validation = validatePatch(draft.values, patch, scenario !== "manual");
    if (validation) {
      setStatus(`${row.name ?? row.id}: ${validation}`);
      return;
    }
    if (scenario === "manual" && !reasonValid) {
      setStatus("변경 사유를 4자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    const result = await app.actions.reviewAdminCourt?.({
      courtId: row.id,
      scenario,
      patch,
      reason: scenario === "manual" ? reason.trim() : undefined,
    });
    if (!result || result.ok === false) {
      setSaving(false);
      setStatus(getSaveErrorMessage(result?.error));
      return;
    }
    clearDraftEdits();
    const refreshedResult = await loadRows(true);
    setSaving(false);
    const aliasText = scenario === "regional_alias" && result.regionalAliasNo ? ` · ${result.regionalAliasNo}번` : "";
    setStatus(`${successMessage}${aliasText}`);
    advanceReviewAfterSave(row.id, refreshedResult);
  };

  const saveReviewAndNext = async () => {
    await commitReview("manual", "수정값을 저장하고 다음 구장으로 이동했습니다.");
  };

  const saveReviewScenario = async (scenario) => {
    await commitReview(scenario.id, `${scenario.label} 처리 후 다음 구장으로 이동했습니다.`);
  };

  const verifyActualCourtCount = async () => {
    if (!reviewRow || saving || proximityLoading) return;
    const actualCount = Number(actualCourtCount);
    if (!Number.isSafeInteger(actualCount) || actualCount < 1) {
      setStatus("실제 코트 수를 1 이상의 정수로 입력해 주세요.");
      return;
    }
    if (reviewValidation) {
      setStatus(`${reviewRow.name ?? reviewRow.id}: ${reviewValidation}`);
      return;
    }
    setSaving(true);
    const result = await app.actions.verifyAdminCourtCount?.({
      courtId: reviewRow.id,
      actualCount,
      facilityName: reviewValues?.facilityName,
      patch: reviewPatch,
    });
    if (!result || result.ok === false) {
      setSaving(false);
      setStatus(getSaveErrorMessage(result?.error));
      return;
    }
    clearDraftEdits();
    const refreshed = await app.actions.loadAdminCourtProximity?.({
      courtId: reviewRow.id,
      facilityName: reviewValues?.facilityName,
    });
    if (refreshed?.ok !== false) setProximityReview(refreshed);
    await loadRows(true);
    setSaving(false);
    const disabled = Number(result.disabledDuplicateCount ?? 0);
    const missing = Number(result.missingRowCount ?? 0);
    setStatus(missing > 0
      ? `실제 ${actualCount}코트로 기록했습니다. DB 행이 ${missing}개 부족합니다.`
      : `실제 ${actualCount}코트로 확정했습니다.${disabled ? ` 초과 ${disabled}개 행은 중복 비활성화했습니다.` : ""}`);
  };

  const saveUpdates = async () => {
    if (!editDirty || saving) return;
    if (editValidation) {
      setStatus(editValidation);
      return;
    }
    if (!reasonValid) {
      setStatus("변경 사유를 4자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    const result = await app.actions.saveAdminCourtBatch?.({
      updates: dirtyUpdates.map(({ courtId, patch }) => ({ courtId, patch })),
      reason: reason.trim(),
    });
    if (!result || result.ok === false) {
      setSaving(false);
      setStatus(getSaveErrorMessage(result?.error));
      return;
    }
    const savedRows = Number(result.updatedCount ?? dirtyUpdates.length);
    const savedFields = dirtyFieldCount;
    resetEdits();
    setSaving(false);
    await loadRows(true);
    setStatus(`${savedRows}개 구장 · ${savedFields}개 셀을 일괄 저장했습니다.`);
  };

  const openDuplicateReview = async () => {
    if (saving || loading || editDirty) {
      if (editDirty) setStatus("미저장 수정값을 먼저 저장하거나 취소해 주세요.");
      return;
    }
    const requestId = duplicateRequestRef.current + 1;
    duplicateRequestRef.current = requestId;
    setDuplicateLoading(true);
    setStatus("중복 주소·근접 코트 목록을 불러오고 있습니다.");
    const result = await app.actions.loadAdminCourtDuplicateGroups?.();
    if (duplicateRequestRef.current !== requestId) return;
    if (!result || result.ok === false) {
      setDuplicateLoading(false);
      const errorCode = String(result?.error ?? "unknown_error");
      setStatus(`${getSaveErrorMessage(errorCode)} (${errorCode})`);
      return;
    }
    const groups = result.groups ?? [];
    setDuplicateLoading(false);
    setDuplicateReview(groups.length ? { groups, index: 0 } : null);
    setDuplicateActualCount(groups.length
      ? String(groups[0].courts.find((court) => court.verifiedCourtCount != null)?.verifiedCourtCount ?? groups[0].detectedCount ?? 1)
      : "");
    setStatus(groups.length
      ? `중복 후보 ${Number(result.groupCount ?? groups.length).toLocaleString()}곳 · ${Number(result.duplicateCourtCount ?? 0).toLocaleString()}개 행`
      : "중복 후보가 없습니다.");
  };

  const moveDuplicateReview = (direction) => {
    if (!duplicateReview || duplicateLoading || saving) return;
    const nextIndex = duplicateReview.index + direction;
    if (nextIndex < 0 || nextIndex >= duplicateReview.groups.length) return;
    setDuplicateReview((current) => ({ ...current, index: nextIndex }));
    const nextGroup = duplicateReview.groups[nextIndex];
    setDuplicateActualCount(String(nextGroup.courts.find((court) => court.verifiedCourtCount != null)?.verifiedCourtCount ?? nextGroup.detectedCount ?? 1));
    setStatus("");
  };

  const closeDuplicateReview = () => {
    if (saving) return;
    duplicateRequestRef.current += 1;
    setDuplicateReview(null);
    setDuplicateLoading(false);
    setDuplicateActualCount("");
    setStatus("");
  };

  const verifyDuplicateGroup = async () => {
    const anchorCourtId = duplicateGroup?.courts?.[0]?.id;
    const actualCount = Number(duplicateActualCount);
    if (!anchorCourtId || saving || duplicateLoading) return;
    if (!Number.isSafeInteger(actualCount) || actualCount < 1) {
      setStatus("실제 코트 수를 1 이상의 정수로 입력해 주세요.");
      return;
    }
    setSaving(true);
    const result = await app.actions.verifyAdminCourtCount?.({
      courtId: anchorCourtId,
      actualCount,
      facilityName: duplicateGroup.facilityName,
      patch: {},
    });
    if (!result || result.ok === false) {
      setSaving(false);
      setStatus(getSaveErrorMessage(result?.error));
      return;
    }
    setSaving(false);
    const disabled = Number(result.disabledDuplicateCount ?? 0);
    const missing = Number(result.missingRowCount ?? 0);
    setStatus(missing > 0
      ? `실제 ${actualCount}코트로 기록 · DB 행 ${missing}개 부족`
      : `실제 ${actualCount}코트 확정${disabled ? ` · 초과 ${disabled}개 중복 비활성화` : ""}`);
    if (duplicateReview.index < duplicateReview.groups.length - 1) {
      const nextIndex = duplicateReview.index + 1;
      const nextGroup = duplicateReview.groups[nextIndex];
      setDuplicateReview((current) => ({ ...current, index: nextIndex }));
      setDuplicateActualCount(String(nextGroup.courts.find((court) => court.verifiedCourtCount != null)?.verifiedCourtCount ?? nextGroup.detectedCount ?? 1));
    } else {
      await loadRows(true);
    }
  };
  return {
    open,
    setOpen,
    tab,
    courtRows,
    historyRows,
    courtPage,
    loading,
    status,
    draftRows,
    activeCell,
    reason,
    setReason,
    reasonOptional,
    saving,
    reviewMode,
    proximityReview,
    proximityLoading,
    actualCourtCount,
    setActualCourtCount,
    duplicateReview,
    duplicateLoading,
    duplicateActualCount,
    setDuplicateActualCount,
    activeColumns,
    activeQuery,
    activeDraft,
    activePage,
    tableWidth,
    dirtyUpdates,
    editDirty,
    dirtyFieldCount,
    editValidation,
    reviewRow,
    selectedRow,
    reviewPosition,
    activeEditedName,
    activeNameDirty,
    reviewValues,
    reviewPatch,
    reviewEditedName,
    reviewValidation,
    reviewUsesCurrentFacility,
    reviewEvidenceDecision,
    reviewEvidenceReference,
    duplicateGroup,
    duplicateDetectedCount,
    duplicateDisplayCourts,
    reasonValid,
    resetEdits,
    closeModal,
    changeTab,
    changeFilter,
    applyFilters,
    resetFilters,
    changeSort,
    changePage,
    activateCell,
    updateEditValue,
    updateReviewValue,
    restoreCell,
    applyQuickStatus,
    startReview,
    stopReview,
    moveReview,
    saveReviewAndNext,
    saveReviewScenario,
    verifyActualCourtCount,
    saveUpdates,
    openDuplicateReview,
    moveDuplicateReview,
    closeDuplicateReview,
    verifyDuplicateGroup,
    modal,
  };
}
