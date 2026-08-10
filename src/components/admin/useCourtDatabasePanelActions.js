import {
  buildPatch,
  buildRowDraft,
  getSaveErrorMessage,
  validatePatch,
} from "./courtDatabaseModel.js";

export default function useCourtDatabasePanelActions(context) {
  const {
    actualCourtCount,
    app,
    clearDraftEdits,
    courtPage,
    dirtyFieldCount,
    dirtyUpdates,
    duplicateActualCount,
    duplicateGroup,
    duplicateLoading,
    duplicateRequestRef,
    duplicateReview,
    editDirty,
    editValidation,
    loadRows,
    loading,
    proximityLoading,
    reason,
    reasonValid,
    resetEdits,
    reviewDraft,
    reviewIndex,
    reviewPatch,
    reviewRow,
    reviewValidation,
    reviewValues,
    saving,
    setCourtQuery,
    setDuplicateActualCount,
    setDuplicateLoading,
    setDuplicateReview,
    setProximityReview,
    setReviewIndex,
    setSaving,
    setStatus,
  } = context;

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
    try {
      const result = await app.actions.reviewAdminCourt?.({
        courtId: row.id,
        scenario,
        patch,
        reason: scenario === "manual" ? reason.trim() : undefined,
      });
      if (!result || result.ok === false) throw new Error(result?.error ?? "unknown_error");
      const refreshedResult = await loadRows(true);
      if (!refreshedResult || refreshedResult.ok === false) throw new Error(refreshedResult?.error ?? "court_refresh_failed");
      clearDraftEdits();
      const aliasText = scenario === "regional_alias" && result.regionalAliasNo ? ` · ${result.regionalAliasNo}번` : "";
      setStatus(`${successMessage}${aliasText}`);
      advanceReviewAfterSave(row.id, refreshedResult);
    } catch (error) {
      setStatus(getSaveErrorMessage(error?.message));
    } finally {
      setSaving(false);
    }
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
    try {
      const result = await app.actions.verifyAdminCourtCount?.({
        courtId: reviewRow.id,
        actualCount,
        facilityName: reviewValues?.facilityName,
        patch: reviewPatch,
      });
      if (!result || result.ok === false) throw new Error(result?.error ?? "unknown_error");
      let proximityWarning = false;
      try {
        const refreshed = await app.actions.loadAdminCourtProximity?.({
          courtId: reviewRow.id,
          facilityName: reviewValues?.facilityName,
        });
        if (refreshed?.ok === false) throw new Error(refreshed.error ?? "unknown_error");
        if (refreshed) setProximityReview(refreshed);
      } catch {
        proximityWarning = true;
      }
      const refreshedResult = await loadRows(true);
      if (!refreshedResult || refreshedResult.ok === false) throw new Error(refreshedResult?.error ?? "court_refresh_failed");
      clearDraftEdits();
      const disabled = Number(result.disabledDuplicateCount ?? 0);
      const missing = Number(result.missingRowCount ?? 0);
      const status = missing > 0
        ? `실제 ${actualCount}코트로 기록했습니다. DB 행이 ${missing}개 부족합니다.`
        : `실제 ${actualCount}코트로 확정했습니다.${disabled ? ` 초과 ${disabled}개 행은 중복 비활성화했습니다.` : ""}`;
      setStatus(`${status}${proximityWarning ? " 근접 코트 조회는 실패했습니다. 다시 시도해 주세요." : ""}`);
    } catch (error) {
      setStatus(getSaveErrorMessage(error?.message));
    } finally {
      setSaving(false);
    }
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
    try {
      const result = await app.actions.saveAdminCourtBatch?.({
        updates: dirtyUpdates.map(({ courtId, patch }) => ({ courtId, patch })),
        reason: reason.trim(),
      });
      if (!result || result.ok === false) throw new Error(result?.error ?? "unknown_error");
      const savedRows = Number(result.updatedCount ?? dirtyUpdates.length);
      const savedFields = dirtyFieldCount;
      const refreshedResult = await loadRows(true);
      if (!refreshedResult || refreshedResult.ok === false) throw new Error(refreshedResult?.error ?? "court_refresh_failed");
      resetEdits();
      setStatus(`${savedRows}개 구장 · ${savedFields}개 셀을 일괄 저장했습니다.`);
    } catch (error) {
      setStatus(getSaveErrorMessage(error?.message));
    } finally {
      setSaving(false);
    }
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
    try {
      const result = await app.actions.loadAdminCourtDuplicateGroups?.();
      if (duplicateRequestRef.current !== requestId) return;
      if (!result || result.ok === false) throw new Error(result?.error ?? "unknown_error");
      const groups = result.groups ?? [];
      setDuplicateReview(groups.length ? { groups, index: 0 } : null);
      setDuplicateActualCount(groups.length
        ? String(groups[0].courts.find((court) => court.verifiedCourtCount != null)?.verifiedCourtCount ?? groups[0].detectedCount ?? 1)
        : "");
      setStatus(groups.length
        ? `중복 후보 ${Number(result.groupCount ?? groups.length).toLocaleString()}곳 · ${Number(result.duplicateCourtCount ?? 0).toLocaleString()}개 행`
        : "중복 후보가 없습니다.");
    } catch (error) {
      if (duplicateRequestRef.current !== requestId) return;
      const errorCode = String(error?.message ?? "unknown_error");
      setStatus(`${getSaveErrorMessage(errorCode)} (${errorCode})`);
    } finally {
      if (duplicateRequestRef.current === requestId) setDuplicateLoading(false);
    }
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
    try {
      const result = await app.actions.verifyAdminCourtCount?.({
        courtId: anchorCourtId,
        actualCount,
        facilityName: duplicateGroup.facilityName,
        patch: {},
      });
      if (!result || result.ok === false) throw new Error(result?.error ?? "unknown_error");
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
        const refreshedResult = await loadRows(true);
        if (!refreshedResult || refreshedResult.ok === false) throw new Error(refreshedResult?.error ?? "court_refresh_failed");
      }
    } catch (error) {
      setStatus(getSaveErrorMessage(error?.message));
    } finally {
      setSaving(false);
    }
  };

  return {
    closeDuplicateReview,
    moveDuplicateReview,
    openDuplicateReview,
    saveReviewAndNext,
    saveReviewScenario,
    saveUpdates,
    verifyActualCourtCount,
    verifyDuplicateGroup,
  };
}
