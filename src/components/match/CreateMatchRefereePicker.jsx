export function CreateMatchRefereePicker({ context, className = "" }) {
  const {
    Button,
    SearchPicker,
    activePlayerIds,
    clearReferee,
    draft,
    favoriteReferees,
    refereeCandidates,
    refereeQuery,
    refereeSearchResults,
    remoteDirectoryEnabled,
    renderRefereeSearchItem,
    selectedReferee,
    setRefereeQuery,
    update,
  } = context;

  return (
    <>
      <div className={["create-referee-row", className].filter(Boolean).join(" ")}>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={draft.refereeWanted || Boolean(draft.refereeId)}
            onChange={(event) => {
              const refereeWanted = event.target.checked;
              update({ refereeWanted, refereeId: refereeWanted ? draft.refereeId : "" });
              if (!refereeWanted) setRefereeQuery("");
            }}
          />
          <span>심판 있음</span>
        </label>
        <label className="create-referee-search">
          심판 검색
          <SearchPicker
            value={refereeQuery}
            onChange={(value) => {
              setRefereeQuery(value);
              update({ refereeWanted: true, refereeId: "" });
            }}
            placeholder="심판 이름, #해시태그, 지역 검색"
            items={refereeSearchResults}
            remoteSearchType={remoteDirectoryEnabled ? "referee" : ""}
            remoteSearchOnFocus={remoteDirectoryEnabled}
            mapRemoteItem={(user) => activePlayerIds.has(user.id) ? null : user}
            idleItems={favoriteReferees.length ? favoriteReferees : refereeCandidates.slice(0, 8)}
            idleTitle={favoriteReferees.length ? "즐겨찾기 심판" : "초대 가능한 심판"}
            title="심판 검색 결과"
            emptyText="초대 가능한 심판 없음"
            showIdleOnFocus
            floating
            closeOnResultClick
            renderItem={renderRefereeSearchItem}
          />
        </label>
      </div>
      {selectedReferee ? (
        <div className="stat-integrity-note create-referee-note">
          <span>{`초대할 심판: ${selectedReferee.name}`}</span>
          <Button type="button" variant="secondary" size="sm" onClick={clearReferee}>초대 해제</Button>
        </div>
      ) : null}
    </>
  );
}
