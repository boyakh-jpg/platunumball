import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Database, ListChecks, RotateCcw, Save, ScanLine, X } from "lucide-react";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import {
  ACTION_COLUMN_WIDTH,
  COURT_COLUMNS,
  HISTORY_COLUMNS,
  REVIEW_SCENARIOS,
  REVIEW_CHIP_GROUPS,
  COURT_UNIT_CHIPS,
  REVIEW_PRIORITY_LABELS,
  FIELD_LABELS,
  formatValue,
  buildRowDraft,
  buildPatch,
  isColumnEditable,
  getDraftCourtName,
} from "./courtDatabaseModel.js";
import {
  SortIcon,
  FilterControl,
  CellEditor,
  ReviewChipGroup,
  CourtMapLinks,
  Pagination,
  ChangeSummary,
} from "./CourtDatabaseControls.jsx";

export default function CourtDatabasePanelView({ controller }) {
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
  } = controller;
const modal = open ? (
    <div className="court-db-modal-backdrop" role="presentation">
      <section className="court-db-modal" role="dialog" aria-modal="true" aria-labelledby="court-db-modal-title">
        <header className="court-db-modal-header">
          <div>
            <p className="eyebrow">Court Database</p>
            <h2 id="court-db-modal-title">구장 DB</h2>
            <small>전체 DB 필터·정렬 · 페이지당 100행 · 수정은 관리자 감사 로그에 기록</small>
          </div>
          <div>
            <strong className="court-db-count">{Number(activePage.total ?? 0).toLocaleString()}개</strong>
            <Button type="button" size="sm" variant="secondary" onClick={closeModal}><X size={15} /> 창 닫기</Button>
          </div>
        </header>

        <div className="court-db-modal-body">
          <div className="segmented-control compact-segments court-db-tabs">
            <button type="button" className={tab === "courts" ? "active" : ""} onClick={() => changeTab("courts")}>구장 검색</button>
            <button type="button" className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}>수정 이력</button>
          </div>

          <div className="court-db-toolbar">
            <small>{reviewMode
              ? "현재 필터 결과를 한 구장씩 검수합니다. 복수 코트는 실제 별도 코트가 확인될 때만 코트 칸을 구분합니다."
              : duplicateReview
                ? "같은 주소·35m 이내 중복 후보를 확인하고 실제 코트 수를 입력합니다."
                : "가로 스크롤은 표 하단에 고정됩니다. 수정 가능한 셀을 누르면 바로 입력할 수 있습니다."}</small>
            <div>
              {tab === "courts" && !reviewMode && !duplicateReview ? (
                <>
                  <Button type="button" size="sm" variant="secondary" disabled={loading || saving || duplicateLoading || !courtRows.length} onClick={() => void openDuplicateReview()}><ScanLine size={14} /> 주소 시설명·중복 코트 정리</Button>
                  <Button type="button" size="sm" variant="secondary" disabled={loading || saving || !courtRows.length} onClick={startReview}><ListChecks size={14} /> 1개씩 검수</Button>
                </>
              ) : null}
              <Button type="button" size="sm" variant="secondary" disabled={loading || Boolean(duplicateReview)} onClick={resetFilters}><RotateCcw size={14} /> 초기화</Button>
              <Button type="button" size="sm" variant="secondary" disabled={loading || Boolean(duplicateReview)} onClick={applyFilters}>{loading ? "조회 중" : "필터 적용"}</Button>
            </div>
          </div>

          {tab === "courts" && !reviewMode && !duplicateReview ? (
            <div className="court-db-edit-toolbar">
              <div>
                <strong>{editDirty ? `${dirtyUpdates.length}개 구장 · ${dirtyFieldCount}개 셀 수정` : selectedRow?.name ?? "수정할 셀을 선택하세요"}</strong>
                <span>{editValidation || (activeNameDirty ? `표준명 변경: ${activeEditedName}` : "ESC: 현재 셀만 원래 값으로 복구")}</span>
              </div>
              <label>
                변경 사유
                <input
                  value={reason}
                  placeholder={reasonOptional ? "boyakh 한시적 입력 잠금" : "4자 이상"}
                  maxLength={160}
                  disabled={saving || reasonOptional}
                  onChange={(event) => setReason(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveUpdates();
                    }
                  }}
                />
              </label>
              <div className="court-db-quick-status">
                <button type="button" disabled={!selectedRow || saving} onClick={() => applyQuickStatus("review")}>확인불가 숨김</button>
                <button type="button" disabled={!selectedRow || saving} onClick={() => applyQuickStatus("disabled")}>비활성화</button>
                <button type="button" disabled={!selectedRow || saving} onClick={() => applyQuickStatus("active")}>활성 복구</button>
              </div>
              <div className="court-db-batch-actions">
                <Button type="button" size="sm" disabled={!editDirty || Boolean(editValidation) || !reasonValid || saving} onClick={saveUpdates}>
                  <Save size={13} /> {saving ? "저장 중" : "일괄 저장"}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={!editDirty || saving} onClick={resetEdits}><X size={13} /> 전체 취소</Button>
              </div>
            </div>
          ) : null}

          {tab === "courts" && duplicateReview && duplicateGroup ? (
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
          ) : null}

          {tab === "courts" && reviewMode && reviewRow && reviewValues ? (
            <div className="court-db-review-workspace">
              <aside className="court-db-review-summary">
                <div className="court-db-review-progress">
                  <strong>남은 {Number(courtPage.total ?? 0).toLocaleString()}개</strong>
                  <span>{reviewPosition.toLocaleString()}번째 · 검수 {Number(reviewRow.admin_review_count ?? 0).toLocaleString()}회</span>
                </div>
                <div>
                  <small>현재 표준명</small>
                  <h3>{reviewEditedName || reviewRow.name}</h3>
                  <p>{reviewRow.road_address || reviewRow.address_text || reviewRow.jibun_address || "주소 없음"}</p>
                </div>
                <dl>
                  <div><dt>읍면동</dt><dd>{reviewRow.emd || "확인 필요"}</dd></div>
                  <div><dt>검수순위</dt><dd>{REVIEW_PRIORITY_LABELS[Number(reviewRow.admin_review_priority)] ?? "검증 완료"}</dd></div>
                  <div><dt>명칭판정</dt><dd>{reviewEvidenceDecision}</dd></div>
                  <div><dt>근거시설</dt><dd>{reviewEvidenceReference}</dd></div>
                  <div><dt>거리</dt><dd>{reviewUsesCurrentFacility || reviewRow.name_evidence_distance_m == null ? "-" : `${reviewRow.name_evidence_distance_m}m`}</dd></div>
                  <div><dt>최근판정</dt><dd>{formatValue({ type: "reviewScenario" }, reviewRow.admin_review_scenario)}</dd></div>
                  <div><dt>지역순번</dt><dd>{reviewRow.regional_alias_no ? `${reviewRow.regional_alias_no}번` : "미부여"}</dd></div>
                </dl>
                <div className="court-db-review-links">
                  <CourtMapLinks court={{ ...reviewRow, name: reviewEditedName || reviewRow.name }} evidenceUrl={reviewRow.name_evidence_url} />
                </div>
              </aside>

              <section className="court-db-review-editor">
                <div className="court-db-review-section-head">
                  <div>
                    <strong>원터치 판정</strong>
                    <small>선택한 속성까지 저장하고 바로 다음 구장으로 이동</small>
                  </div>
                  {editDirty ? <span>{Object.keys(reviewPatch).length}개 값 변경</span> : <span>속성 변경 없음</span>}
                </div>
                <div className="court-db-review-scenarios">
                  {REVIEW_SCENARIOS.map((scenario) => {
                    const unavailable = scenario.id === "regional_alias" && !reviewRow.emd;
                    return (
                      <button
                        key={scenario.id}
                        type="button"
                        data-tone={scenario.tone}
                        disabled={loading || saving || unavailable}
                        title={unavailable ? "읍면동 확인 필요" : scenario.description}
                        onClick={() => void saveReviewScenario(scenario)}
                      >
                        <strong>{scenario.label}</strong>
                        <span>{scenario.description}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="court-db-review-primary-fields">
                  <label className={Object.prototype.hasOwnProperty.call(reviewPatch, "facilityName") ? "is-dirty" : ""}>
                    시설명 (표준명 자동 반영)
                    <input value={reviewValues.facilityName ?? ""} disabled={saving} onChange={(event) => updateReviewValue("facilityName", event.target.value)} />
                  </label>
                  <label className={Object.prototype.hasOwnProperty.call(reviewPatch, "courtUnit") ? "is-dirty" : ""}>
                    코트 구분
                    <input value={reviewValues.courtUnit ?? ""} placeholder="예: 1코트" disabled={saving} onChange={(event) => updateReviewValue("courtUnit", event.target.value)} />
                  </label>
                  <div className="court-db-review-unit-chips">
                    {COURT_UNIT_CHIPS.map(([value, label]) => {
                      const selected = Object.is(reviewValues.courtUnit ?? null, value ?? null);
                      return <button key={String(value)} type="button" className={selected ? "selected" : ""} aria-pressed={selected} disabled={saving} onClick={() => updateReviewValue("courtUnit", value)}>{label}</button>;
                    })}
                  </div>
                </div>

                <section className="court-db-proximity-review" aria-busy={proximityLoading}>
                  <div className="court-db-review-section-head">
                    <div>
                      <strong>30m 자동 병합 · 실제 코트 수 검증</strong>
                      <small>근접한 DB 행은 같은 시설명과 1코트~N코트로 자동 묶임</small>
                    </div>
                    <span>{proximityLoading ? "검사 중" : `${Number(proximityReview?.detectedCount ?? 1).toLocaleString()}개 행 감지`}</span>
                  </div>
                  <div className="court-db-proximity-answer">
                    <label>
                      이 장소에는 실제 코트가 몇 개 있나요?
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={actualCourtCount}
                        disabled={saving || proximityLoading}
                        onChange={(event) => setActualCourtCount(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void verifyActualCourtCount();
                          }
                        }}
                      />
                    </label>
                    <div>
                      {Number(actualCourtCount) < Number(proximityReview?.detectedCount ?? 1)
                        ? <span className="is-warning">초과 {Number(proximityReview?.detectedCount ?? 1) - Number(actualCourtCount)}개 행 중복 비활성화</span>
                        : Number(actualCourtCount) > Number(proximityReview?.detectedCount ?? 1)
                          ? <span>DB 행 {Number(actualCourtCount) - Number(proximityReview?.detectedCount ?? 1)}개 부족 기록</span>
                          : <span>감지된 DB 행 수와 같음</span>}
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving || proximityLoading || !Number.isSafeInteger(Number(actualCourtCount)) || Number(actualCourtCount) < 1}
                        onClick={() => void verifyActualCourtCount()}
                      >
                        <ScanLine size={14} /> 코트 수 확정
                      </Button>
                    </div>
                  </div>
                  {proximityReview?.courts?.length ? (
                    <div className="court-db-proximity-courts">
                      {proximityReview.courts.map((court) => (
                        <span key={court.id} className={court.proximityExcess ? "is-excess" : ""}>
                          <b>{court.courtUnit || "단일 코트"}</b>
                          {court.distanceM == null ? "거리 미상" : `${court.distanceM}m`}
                          {court.proximityExcess ? " · 중복 비활성" : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>

                <div className="court-db-review-subhead">
                  <strong>코트 속성</strong>
                  <span>선택한 값은 판정과 함께 저장</span>
                </div>
                <div className="court-db-review-chip-grid">
                  {REVIEW_CHIP_GROUPS.map((group) => (
                    <ReviewChipGroup
                      key={group.key}
                      group={group}
                      value={reviewValues[group.key]}
                      dirty={Object.prototype.hasOwnProperty.call(reviewPatch, group.key)}
                      disabled={saving}
                      onChange={updateReviewValue}
                    />
                  ))}
                </div>

                <label className="court-db-review-reason">
                  수동 저장 사유
                  <input
                    value={reason}
                    placeholder={reasonOptional ? "boyakh 한시적 자동 기록" : "수동 저장 때 4자 이상"}
                    maxLength={160}
                    disabled={saving || reasonOptional}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              </section>
            </div>
          ) : null}

          {tab === "courts" && reviewMode ? (
            <div className="court-db-review-controls">
              <div className="court-db-review-progress">
                <strong>{reviewRow?.name ?? "검수할 구장이 없습니다."}</strong>
                <span>{reviewValidation || (editDirty ? "붉게 표시된 값을 저장할 수 있습니다." : "판정 버튼은 즉시 저장됩니다.")}</span>
              </div>
              <div className="court-db-review-actions">
                <Button type="button" size="sm" variant="secondary" disabled={loading || saving || editDirty || reviewPosition <= 1} onClick={() => moveReview(-1)}><ChevronLeft size={14} /> 이전</Button>
                <Button type="button" size="sm" variant="secondary" disabled={loading || saving || editDirty || !reviewRow} onClick={() => moveReview(1)}>변경 없이 다음 <ChevronRight size={14} /></Button>
                <Button type="button" size="sm" disabled={loading || saving || !editDirty || Boolean(reviewValidation) || !reasonValid} onClick={() => void saveReviewAndNext()}><Save size={13} /> {saving ? "저장 중" : "수동 저장 후 다음"}</Button>
                <Button type="button" size="sm" variant="secondary" disabled={!editDirty || saving} onClick={resetEdits}><RotateCcw size={13} /> 수정 취소</Button>
                <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={stopReview}><X size={13} /> 검수 종료</Button>
              </div>
            </div>
          ) : null}

          {status ? <p className="court-db-status">{status}</p> : null}

          {(!reviewMode && !duplicateReview) || tab === "history" ? <div className="court-db-table-wrap">
            <table className={`court-db-table ${tab === "history" ? "court-db-table-history" : ""}`} style={{ width: `${tableWidth}px` }}>
              <colgroup>
                {tab === "courts" ? <col style={{ width: `${ACTION_COLUMN_WIDTH}px` }} /> : null}
                {activeColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {tab === "courts" ? <th className="court-db-sticky-actions">작업</th> : null}
                  {activeColumns.map((column) => (
                    <th key={column.key}>
                      <button type="button" className="court-db-sort" onClick={() => changeSort(column.key)}>
                        <span title={column.label}>{column.label}</span><SortIcon active={activeQuery.sortKey === column.key} direction={activeQuery.sortDirection} />
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="court-db-filter-row">
                  {tab === "courts" ? <th className="court-db-sticky-actions"><span>좌측 고정</span></th> : null}
                  {activeColumns.map((column) => (
                    <th key={column.key}>
                      <FilterControl
                        column={column}
                        value={activeDraft[column.key] ?? ""}
                        onChange={(value) => changeFilter(column.key, value)}
                        onEnter={applyFilters}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === "courts" ? courtRows.map((row) => {
                  const rowDraft = draftRows[row.id];
                  const rowValues = rowDraft?.values ?? buildRowDraft(row);
                  const rowPatch = buildPatch(rowDraft);
                  const rowDirty = Object.keys(rowPatch).length > 0;
                  const editedName = rowDirty ? getDraftCourtName(row, rowValues) : row.name;
                  const nameDirty = Boolean(editedName && editedName !== row.name);
                  const rowActive = activeCell?.courtId === row.id;
                  return (
                    <tr key={row.id} className={[rowDirty ? "court-db-row-editing" : "", rowActive ? "court-db-row-active" : ""].filter(Boolean).join(" ")}>
                      <td className="court-db-actions court-db-sticky-actions">
                        <CourtMapLinks court={row} />
                        {rowDirty ? <span className="court-db-row-dirty-count">{Object.keys(rowPatch).length}셀</span> : null}
                      </td>
                      {COURT_COLUMNS.map((column) => {
                        const columnEditable = isColumnEditable(row, column);
                        const columnDirty = rowDirty && (column.key === "name"
                          ? nameDirty
                          : column.patchKey && Object.prototype.hasOwnProperty.call(rowPatch, column.patchKey));
                        const cellActive = columnEditable && activeCell?.courtId === row.id && activeCell.patchKey === column.patchKey;
                        const displayValue = column.key === "name" ? editedName : column.patchKey ? rowValues[column.patchKey] : row[column.rowKey];
                        return (
                          <td
                            key={column.key}
                            className={[columnDirty ? "court-db-cell-dirty" : "", columnEditable ? "court-db-editable-cell" : "", cellActive ? "court-db-cell-active" : ""].filter(Boolean).join(" ")}
                            title={formatValue(column, displayValue)}
                            tabIndex={columnEditable ? 0 : undefined}
                            onClick={() => activateCell(row, column)}
                            onKeyDown={(event) => {
                              if (columnEditable && (event.key === "Enter" || event.key === "F2")) {
                                event.preventDefault();
                                activateCell(row, column);
                              }
                            }}
                          >
                            {cellActive ? (
                              <CellEditor
                                column={column}
                                value={rowValues[column.patchKey]}
                                disabled={saving}
                                onChange={(value) => updateEditValue(row, column.patchKey, value)}
                                onEscape={() => restoreCell(row, column.patchKey)}
                              />
                            ) : column.type === "osmEvidenceUrl" && displayValue ? (
                              <a href={String(displayValue)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>OSM 열기</a>
                            ) : formatValue(column, displayValue)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }) : historyRows.map((row) => (
                  <tr key={row.id}>
                    {HISTORY_COLUMNS.map((column) => (
                      <td key={column.key} className={column.key === "changesText" ? "court-db-history-cell" : ""} title={column.key === "changesText" ? undefined : formatValue(column, row[column.rowKey])}>
                        {column.key === "changesText" ? <ChangeSummary changes={row.changes} /> : column.key === "changedFields"
                          ? Object.keys(row.changes ?? {}).map((key) => FIELD_LABELS[key] ?? key).join(", ") || "-"
                          : formatValue(column, row[column.rowKey])}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !(tab === "courts" ? courtRows : historyRows).length ? (
                  <tr><td colSpan={activeColumns.length + (tab === "courts" ? 1 : 0)} className="court-db-empty">조건에 맞는 데이터가 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div> : null}

          {(!reviewMode && !duplicateReview) || tab === "history" ? <Pagination page={activePage} onChange={changePage} loading={loading} /> : null}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <Card className="section-card court-db-launcher">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Court Database</p>
            <h2>구장 DB</h2>
            <small>대형 편집 창에서 전체 구장과 수정 이력을 관리합니다.</small>
          </div>
          <Button type="button" onClick={() => setOpen(true)}><Database size={16} /> 구장 DB 열기</Button>
        </div>
      </Card>
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}
