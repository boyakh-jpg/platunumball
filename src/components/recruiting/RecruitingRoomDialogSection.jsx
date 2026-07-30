export function RecruitingRoomDialogSection({ context }) {
  const {
    Button, MatchFinalizeDialog, X, closeModal, confirmDeleteSourceSoloRecord, confirmSourceMatchFinalization,
    createPortal, finalizeMatchPending, finalizeMatchTarget, roomCancellationPending, roomCancellationPolicy, roomCancellationTarget,
    setFinalizeMatchTarget, setInviteDraft, setRoomCancellationTarget, setSoloRecordDeleteTarget, soloRecordDeleteTarget, submitRoomCancellation,
  } = context;

  return (
    <>
{soloRecordDeleteTarget && typeof document !== "undefined" ? createPortal(
                <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setSoloRecordDeleteTarget(null)}>
                  <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="개인 기록 삭제 확인" onMouseDown={(event) => event.stopPropagation()}>
                    <strong>개인 기록 삭제</strong>
                    <p>삭제하면 내 기록 목록에서 사라집니다. MMR은 변하지 않습니다.</p>
                    <div className="app-confirm-actions">
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
                      {roomCancellationPolicy.penalty > 0
                        ? `취소하면 신뢰도 ${roomCancellationPolicy.penalty}점이 감소합니다.`
                        : roomCancellationPolicy.waived
                          ? "이번 취소는 신뢰도 차감이 면제됩니다."
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
                          reason: event.target.value,
                          error: "",
                        }))}
                        placeholder="참가자에게 보여줄 취소 사유를 입력해 주세요."
                      />
                    </label>
                    <small className={roomCancellationTarget.error ? "error" : ""}>
                      {roomCancellationTarget.error || `${roomCancellationTarget.reason.length}/200`}
                    </small>
                    <div className="app-confirm-actions">
                      <Button type="button" variant="secondary" disabled={roomCancellationPending} onClick={() => setRoomCancellationTarget(null)}>돌아가기</Button>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="danger-button"
                        disabled={roomCancellationPending || roomCancellationTarget.reason.trim().length < 5}
                      >
                        {roomCancellationPending ? "취소 처리 중" : roomCancellationTarget.label}
                      </Button>
                    </div>
                  </form>
                </div>,
                document.body,
              ) : null}
              <MatchFinalizeDialog
                open={Boolean(finalizeMatchTarget)}
                pending={finalizeMatchPending}
                openDisputeCount={finalizeMatchTarget?.openDisputeCount ?? 0}
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
