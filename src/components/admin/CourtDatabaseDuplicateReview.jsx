import { ChevronLeft, ChevronRight, ScanLine, X } from "lucide-react";
import Button from "../common/Button.jsx";
import {
  CourtMapLinks,
} from "./CourtDatabaseControls.jsx";

export function CourtDatabaseDuplicateReview({ controller }) {
  const {
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
  } = controller;
  return (tab === "courts" && duplicateReview && duplicateGroup ? (
            <section className="court-db-duplicate-review" aria-busy={duplicateLoading}>
              <header className="court-db-duplicate-header">
                <div>
                  <small>중복 후보 {duplicateReview.index + 1} / {duplicateReview.groups.length}</small>
                  <h3>{duplicateGroup.facilityName || duplicateDisplayCourts[0]?.name || "시설명 확인 필요"}</h3>
                  <p>{duplicateGroup.address || "주소 없음"}</p>
                </div>
                <div>
                  <strong>{duplicateDetectedCount.toLocaleString()}개 DB 행</strong>
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={closeDuplicateReview}><X size={14} /> 중복 검수 종료</Button>
                </div>
              </header>

              <div className="court-db-duplicate-courts">
                {duplicateDisplayCourts.map((court, index) => (
                  <article key={court.id} className={court.proximityExcess ? "is-excess" : ""}>
                    <div>
                      <strong>{index + 1}. {court.name || court.facilityName || court.id}</strong>
                      <span>{court.courtUnit || "코트 구분 미확정"} · {court.status === "disabled" ? "비활성" : "활성"}</span>
                      <small>{court.address || duplicateGroup.address || "주소 없음"}</small>
                    </div>
                    <CourtMapLinks court={{
                      ...court,
                      facility_name: court.facilityName,
                      court_unit: court.courtUnit,
                    }} />
                  </article>
                ))}
              </div>

              <div className="court-db-duplicate-answer">
                <label>
                  이 장소에 실제 코트가 몇 개 있나요?
                  <input
                    className="ui-control"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={duplicateActualCount}
                    disabled={saving || duplicateLoading}
                    onChange={(event) => setDuplicateActualCount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void verifyDuplicateGroup();
                      }
                    }}
                  />
                </label>
                <div>
                  {Number(duplicateActualCount) < duplicateDetectedCount
                    ? <span className="is-warning">초과 {duplicateDetectedCount - Number(duplicateActualCount)}개 행을 중복 비활성화</span>
                    : Number(duplicateActualCount) > duplicateDetectedCount
                      ? <span>DB 행 {Number(duplicateActualCount) - duplicateDetectedCount}개 부족 기록</span>
                      : <span>감지된 DB 행 수와 같음</span>}
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving || duplicateLoading || !Number.isSafeInteger(Number(duplicateActualCount)) || Number(duplicateActualCount) < 1}
                    onClick={() => void verifyDuplicateGroup()}
                  >
                    <ScanLine size={14} /> 이 코트 수로 확정
                  </Button>
                </div>
              </div>

              <footer className="court-db-duplicate-navigation">
                <Button type="button" size="sm" variant="secondary" disabled={saving || duplicateLoading || duplicateReview.index <= 0} onClick={() => moveDuplicateReview(-1)}><ChevronLeft size={14} /> 이전 중복</Button>
                <span>{duplicateLoading ? "그룹 계산 중" : "확정하면 자동으로 다음 중복 후보로 이동"}</span>
                <Button type="button" size="sm" variant="secondary" disabled={saving || duplicateLoading || duplicateReview.index >= duplicateReview.groups.length - 1} onClick={() => moveDuplicateReview(1)}>다음 중복 <ChevronRight size={14} /></Button>
              </footer>
            </section>
          ) : null);
}
