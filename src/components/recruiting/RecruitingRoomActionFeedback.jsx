export default function RecruitingRoomActionFeedback({ context }) {
  const {
    Button,
    MatchRecommendationPanel,
    app,
    confirmPaidCourtJoin,
    createPortal,
    matchRoom,
    paidCourtJoinPrompt,
    setPaidCourtJoinPrompt,
    sourceMatch,
  } = context;

  return (
    <>
      {matchRoom && sourceMatch ? (
        <MatchRecommendationPanel
          match={sourceMatch}
          currentUserId={app.currentUser.id}
          users={app.state.users}
          teams={app.state.teams}
          onSubmit={app.actions.submitMatchThumbs}
          className="arena-match-recommendation"
        />
      ) : null}
      {paidCourtJoinPrompt && typeof document !== "undefined" ? createPortal(
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setPaidCourtJoinPrompt(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="유료 구장 참여 확인" onMouseDown={(event) => event.stopPropagation()}>
            <strong>유료 구장입니다.</strong>
            <p>참가비나 대관료를 미리 확인하고 참여해 주세요.</p>
            <div className="ui-action-row app-confirm-actions">
              <Button type="button" variant="secondary" onClick={() => setPaidCourtJoinPrompt(null)}>취소</Button>
              <Button type="button" variant="primary" onClick={confirmPaidCourtJoin}>계속 참여</Button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
