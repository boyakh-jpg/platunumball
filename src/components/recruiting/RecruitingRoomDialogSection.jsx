export function RecruitingRoomDialogSection({ context }) {
  const {
    Button, MatchFinalizeDialog, X, closeModal, confirmDeleteSourceSoloRecord, confirmSourceMatchFinalization,
    getMatchRoomPhase,
    createPortal, finalizeMatchPending, finalizeMatchTarget, roomCancellationPending, roomCancellationPolicy, roomCancellationTarget,
    roomHelpOpen, selectedPost, setFinalizeMatchTarget, setInviteDraft, setRoomCancellationTarget, setRoomHelpOpen, setSoloRecordDeleteTarget,
    soloRecordDeleteTarget, sourceManualFinalizationStatus, sourceMatch, sourceOpenDisputes, submitRoomCancellation,
  } = context;
  const roomPhase = sourceMatch ? getMatchRoomPhase(sourceMatch).phase : "recruiting";
  const recordType = sourceMatch?.rules?.recordType ?? "match";
  const helpSections = recordType === "solo" ? [
    ["기록 만들기", "날짜·구장·경기 방식과 내 점수·활약을 입력하면 돼요. 다른 사람은 참가자로 등록되지 않아요."],
    ["사후 기록", "경기가 끝난 뒤 입력해도 돼요. 내 기록은 내가 저장하고 수정해요. 공식 팀 경기 전적과는 분리돼요."],
    ["공개 범위", "공개 기록은 프로필에서 볼 수 있고 비공개 기록은 본인만 볼 수 있어요."],
  ] : recordType === "match_record" ? [
    ["명단 등록", "실제로 함께 뛴 참가자를 양쪽 명단에 넣으면 돼요. 후보도 실제 참가자만 등록해요."],
    ["점수 입력", "경기가 끝난 뒤 최종 점수를 입력하면 참가자에게 확인 요청이 가요."],
    ["참가 확인", "실제 참가자의 2/3 이상이 확인하면 기록이 확정돼요. 확인하지 않은 사람은 MMR 반영에서 빠져요."],
  ] : sourceMatch ? [
    ["방장", sourceMatch.refereeId
      ? "일정·구장·명단을 관리해요. 심판이 있는 경기에서는 점수·교체·종료·최종 확정을 심판이 맡아요."
      : "일정·구장·명단을 관리하고 출석 확인, 경기 시작·종료, 결과 확정을 맡아요."],
    ["주장", "자기 팀의 출전·후보 명단을 확인하고 팀원에게 변경 내용을 알려요. 경기 운영 권한은 자동으로 생기지 않아요."],
    ["확정 뒤 참가 취소", "경기 시작 전에는 사유를 적고 참가를 취소할 수 있어요. 후보가 있으면 자동 출전 전환하고, 부족하면 방장에게 인원 보충 필요가 표시돼요. 출석 단계 취소는 신뢰도 차감이 더 커요."],
    ["출석", sourceMatch.rules?.qrAttendanceEnabled === true
      ? "경기 20분 전부터 모바일 전광판의 QR을 열어요. 등록된 출전·후보 선수가 자기 휴대폰으로 스캔하면 돼요."
      : "경기 10분 전부터 방장 또는 배정 심판이 명단의 출석을 확인하면 돼요."],
    ["모바일 전광판", "경기를 뛰는 사람의 휴대폰이나 태블릿으로 경기시계·점수 입력판·출석 QR·샷클락을 써요. 실시간 점수 입력과 부저가 중복되지 않도록 담당자는 한 명만 지정해요. 방장이나 배정 심판이 담당자를 지정·변경할 수 있고, 현재 담당자도 권한을 다른 출전선수·후보선수·배정 심판에게 넘길 수 있어요."],
    ["점수·교체", sourceMatch.refereeId
      ? "배정 심판이 양쪽 점수와 개인 기록, 교체를 처리해요. 모바일 전광판 담당자는 경기시간과 샷클락만 조작해요. 후보선수는 들어갈 출전선수를 고른 뒤 `출전선수와 교체`를 눌러야 출전할 수 있어요."
      : "모바일 전광판 담당자가 양쪽 점수를 입력해요. 후보선수는 자기 팀에서 들어갈 출전선수를 고른 뒤 `출전선수와 교체`를 눌러야 출전할 수 있어요."],
    ["경기 종료", sourceMatch.refereeId
      ? "배정 심판이 경기를 종료하고 이의를 처리한 뒤 기록을 확정해요. 방장은 심판 대신 확정하지 않아요."
      : "방장이 경기를 종료하고 결과와 이의를 확인한 뒤 기록을 확정해요."],
    ["인원 부족 취소", "후보 출전 전환 뒤에도 출전 인원이 부족하면 먼저 보충해요. 진행이 어렵다면 방장이 경기 취소 사유를 적어 취소하고, 모든 참가자에게 알림이 가요."],
  ] : [
    ["참가", "개인 또는 팀으로 참가하고 출전·후보를 고르면 돼요. 팀 파티는 주장이 명단을 정리해요."],
    ["경기 확정", "양쪽 출전 인원이 차고 일정 조건을 통과하면 방장이 확정해요. 확정 뒤에는 경기준비방으로 바뀌어요."],
    ["변경 확인", "확정 전 일정·구장·규칙이 바뀌면 현재 참가자가 다시 확인해야 해요."],
    ["다음 단계", "확정 뒤 출석, 모바일 전광판 담당 지정, 경기 시작 순서로 진행해요."],
  ];
  const phaseLabels = {
    recruiting: "모집 중",
    locked: "경기 확정",
    checkin: "출석·경기 준비",
    live: "경기 진행",
    postgame: "경기 종료·기록 입력",
    dispute: "이의 확인",
    record: "기록 확정",
  };
  const phaseHelpTitles = {
    recruiting: "참가",
    locked: "확정 뒤 참가 취소",
    checkin: "출석",
    live: "모바일 전광판",
    postgame: "경기 종료",
    dispute: "경기 종료",
    record: recordType === "match_record" ? "참가 확인" : "공개 범위",
  };
  const currentHelpTitle = phaseHelpTitles[roomPhase];
  const orderedHelpSections = currentHelpTitle
    ? [
        ...helpSections.filter(([title]) => title === currentHelpTitle),
        ...helpSections.filter(([title]) => title !== currentHelpTitle),
      ]
    : helpSections;

  return (
    <>
              {roomHelpOpen && typeof document !== "undefined" ? createPortal(
                <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setRoomHelpOpen(false)}>
                  <section
                    className="app-confirm-dialog room-help-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="room-help-title"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <header className="room-help-head">
                      <div>
                        <small>{phaseLabels[roomPhase] ?? "방 진행"}</small>
                        <strong id="room-help-title">{selectedPost.title || sourceMatch?.title || "경기방"} 도움말</strong>
                      </div>
                      <Button type="button" size="sm" variant="secondary" className="arena-room-help-button" aria-label="도움말 닫기" onClick={() => setRoomHelpOpen(false)}>
                        <X size={20} />
                      </Button>
                    </header>
                    <div className="room-help-list">
                      {orderedHelpSections.map(([title, body], index) => (
                        <details key={title} open={index === 0}>
                          <summary>{title}</summary>
                          <p>{body}</p>
                        </details>
                      ))}
                    </div>
                    <Button type="button" variant="secondary" onClick={() => setRoomHelpOpen(false)}>확인</Button>
                  </section>
                </div>,
                document.body,
              ) : null}
{soloRecordDeleteTarget && typeof document !== "undefined" ? createPortal(
                <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setSoloRecordDeleteTarget(null)}>
                  <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="개인 기록 삭제 확인" onMouseDown={(event) => event.stopPropagation()}>
                    <strong>개인 기록 삭제</strong>
                    <p>삭제하면 내 기록 목록에서 사라집니다. MMR은 변하지 않습니다.</p>
                    <div className="ui-action-row app-confirm-actions">
                      <Button type="button" variant="secondary" onClick={() => setSoloRecordDeleteTarget(null)}>취소</Button>
                      <Button type="button" variant="primary" className="danger-button" onClick={confirmDeleteSourceSoloRecord}>삭제하기</Button>
                    </div>
                  </div>
                </div>,
                document.body,
              ) : null}
              {roomCancellationTarget && typeof document !== "undefined" ? createPortal(
                <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !roomCancellationPending && setRoomCancellationTarget(null)}>
                  <form
                    className="app-confirm-dialog room-cancellation-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${roomCancellationTarget.label} 사유 입력`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onSubmit={submitRoomCancellation}
                  >
                    <strong>{roomCancellationTarget.label}</strong>
                    <p>
                      {(roomCancellationTarget.kind === "participation" ? roomCancellationTarget.penalty : roomCancellationPolicy.penalty) > 0
                        ? `취소하면 신뢰도 ${roomCancellationTarget.kind === "participation" ? roomCancellationTarget.penalty : roomCancellationPolicy.penalty}점이 감소합니다.`
                        : roomCancellationPolicy.waived
                          ? "이번 취소는 신뢰도 차감이 면제됩니다."
                          : roomCancellationTarget.kind === "participation"
                            ? "취소하면 경기 명단에서 빠집니다."
                            : "취소한 방은 복구할 수 없습니다."}
                    </p>
                    <label>
                      취소 사유
                      <textarea
                        autoFocus
                        required
                        minLength={5}
                        maxLength={200}
                        disabled={roomCancellationPending}
                        value={roomCancellationTarget.reason}
                        onChange={(event) => setRoomCancellationTarget((current) => ({
                          ...current,
                          reason: event.target.value.slice(0, 200),
                          error: "",
                        }))}
                        placeholder={roomCancellationTarget.kind === "participation" ? "방장에게 보여줄 참가 취소 사유" : "참가자에게 보여줄 취소 사유를 입력해 주세요."}
                      />
                    </label>
                    <small className={roomCancellationTarget.error ? "error" : ""}>
                      {roomCancellationTarget.error || `${roomCancellationTarget.reason.length}/200`}
                    </small>
                    <div className="ui-action-row app-confirm-actions">
                      <Button type="button" variant="secondary" disabled={roomCancellationPending} onClick={() => setRoomCancellationTarget(null)}>돌아가기</Button>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="danger-button"
                        disabled={roomCancellationPending || roomCancellationTarget.reason.trim().length < 5 || roomCancellationTarget.reason.length > 200}
                      >
                        {roomCancellationPending ? "취소 처리 중" : roomCancellationTarget.label}
                      </Button>
                    </div>
                  </form>
                </div>,
                document.body,
              ) : null}
              <MatchFinalizeDialog
                open={Boolean(finalizeMatchTarget && finalizeMatchTarget.matchId === sourceMatch?.id)}
                pending={finalizeMatchPending}
                openDisputeCount={sourceOpenDisputes.length}
                eligible={sourceManualFinalizationStatus.ready}
                authorityLabel={finalizeMatchTarget?.authorityLabel ?? "방장"}
                onClose={() => setFinalizeMatchTarget(null)}
                onConfirm={confirmSourceMatchFinalization}
              />
              <div className="arena-modal-close-row">
                <Button
                  type="button"
                  variant="secondary"
                  className="arena-modal-close-button"
                  onClick={() => { setInviteDraft(null); closeModal(); }}
                >
                  <X size={20} /> 방 닫기
                </Button>
              </div>
    </>
  );
}
