import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { PersonalRecordMetaLabels } from "../components/match/MatchRecordMeta.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import ProfileBasicsFields from "../components/profile/ProfileBasicsFields.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import ProfileIconDialog from "../components/profile/ProfileIconDialog.jsx";
import AffiliationEditor from "../components/profile/AffiliationEditor.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import { BASKETBALL_POSITIONS } from "../lib/constants.js";
import { getUserHashtag } from "../lib/handles.js";
import { getMatchSideScore as getSideScore, getPlayerMatchResult, getPlayerRecentRecordMatches, getPlayerSideName, isPersonalRecordMatch } from "../lib/matchUtils.js";
import { canChangeProfileName, getNextNameChangeDate, getRegionDistrictOptions, inferRegionSelection } from "../lib/profileSetup.js";
import { isPlacementComplete } from "../lib/rating.js";
import { MatchRoomModal } from "./Matches.jsx";

function getUserRecordLine(match, userId) {
  const sideName = getPlayerSideName(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getPlayerMatchResult(match, userId),
  };
}

function getAverageFouls(matches = [], userId) {
  const confirmed = matches.filter((match) => match.status === "confirmed" && match.result && match.refereeId && !isPersonalRecordMatch(match) && getPlayerSideName(match, userId));
  if (!confirmed.length) return 0;
  const total = confirmed.reduce((sum, match) => sum + Number(match.result?.playerStats?.[userId]?.fouls ?? 0), 0);
  return total / confirmed.length;
}

function getProfileAverageFouls(user = {}, matches = []) {
  const summaryAverage = Number(user.matchSummary?.averageFouls);
  if (user.matchSummary && Number.isFinite(summaryAverage)) return summaryAverage;
  return getAverageFouls(matches, user.id);
}

function formatDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function RecentRecordCard({ records, userId, teams, onOpenRecord, loading = false }) {
  return (
    <Card className="section-card profile-record-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Record</p>
          <h2>최근 기록</h2>
        </div>
        <Button as={Link} variant="secondary" size="sm" to="/app/profile/records">기록 더보기</Button>
      </div>
      {loading ? (
        <div className="ui-empty-state-compact">기록 정리 중</div>
      ) : records.length ? (
        <div className="recent-match-list">
          {records.map((match) => {
            const line = getUserRecordLine(match, userId);
            return (
              <RecentMatchRow
                key={match.id}
                record={match}
                result={line.result}
                side={line.side}
                opponent={line.opponent}
                score={line.score}
                opponentScore={line.opponentScore}
                teams={teams}
                to={`/app/matches?match=${match.id}`}
                onOpen={() => onOpenRecord(match.id)}
                afterCourt={isPersonalRecordMatch(match) ? <PersonalRecordMetaLabels visibility={match.visibility} /> : null}
              />
            );
          })}
        </div>
      ) : (
        <div className="ui-empty-state-compact">확정된 경기 기록이 없습니다.</div>
      )}
    </Card>
  );
}

export default function Profile({ app }) {
  const user = app.currentUser;
  const inferredRegion = inferRegionSelection([user.regionSido, user.regionDistrict, user.region].filter(Boolean).join(" "));
  const [draft, setDraft] = useState({
    name: user.name ?? "",
    position: BASKETBALL_POSITIONS.includes(user.position) ? user.position : "PG",
    regionSido: inferredRegion.sido,
    regionDistrict: inferredRegion.district,
  });
  const [profileError, setProfileError] = useState("");
  const [selectedRecordMatchId, setSelectedRecordMatchId] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [emblemFeedback, setEmblemFeedback] = useState("");
  const [iconDialogOpen, setIconDialogOpen] = useState(false);
  const recordsLoadKeyRef = useRef("");
  const districtOptions = getRegionDistrictOptions(draft.regionSido);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    if (draft.name !== user.name && !canChangeProfileName(user)) {
      setProfileError(`닉네임은 월 1회만 변경할 수 있습니다. 다음 변경 가능일: ${formatDate(getNextNameChangeDate(user))}`);
      return;
    }
    setProfileError("");
    const district = districtOptions.includes(draft.regionDistrict) ? draft.regionDistrict : districtOptions[0];
    try {
      await app.actions.updateProfile({
        name: draft.name,
        position: draft.position,
        region: `${draft.regionSido} ${district}`,
        regionSido: draft.regionSido,
        regionDistrict: district,
      });
    } catch (error) {
      setProfileError("프로필을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
    }
  };
  const myRecords = getPlayerRecentRecordMatches(app.state.matches, user.id, { limit: 6 });
  useEffect(() => {
    const shouldLoadRecords = !app.actions.profileRecordsLoaded;
    if (!app.remoteReady || !app.actions.loadProfileRecords || !shouldLoadRecords) return;
    const loadKey = user.id;
    if (recordsLoadKeyRef.current === loadKey) return;
    recordsLoadKeyRef.current = loadKey;
    setRecordsLoading(true);
    const request = app.actions.loadProfileRecords({ force: app.actions.profileRecordsLoaded && myRecords.length === 0 });
    if (!request?.then) {
      if (!request) recordsLoadKeyRef.current = "";
      setRecordsLoading(false);
      return;
    }
    request.then((count) => {
      if (count === false) recordsLoadKeyRef.current = "";
    }).catch(() => {
      recordsLoadKeyRef.current = "";
    }).finally(() => {
      setRecordsLoading(false);
    });
  }, [app.actions, app.remoteReady, myRecords.length, user.id]);
  const averageFouls = getProfileAverageFouls(user, app.state.matches);
  const recordsPending = (!app.actions.profileRecordsLoaded || recordsLoading) && !myRecords.length;
  return (
    <div className="page-stack profile-page">
      <header className="page-header ui-design-app-hero">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/signup">가입 정보 설정</Button>
      </header>
      <div className="content-grid profile-overview-grid">
        <div className="page-stack profile-main-stack">
          <Card className="section-card profile-emblem-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">My Icon</p>
                <h2>프로필 아이콘</h2>
              </div>
              <div className="profile-icon-card-tools">
                <ProfileEmblem user={user} className="hero-avatar" />
                <div className="profile-icon-card-actions">
                  <Button type="button" size="sm" onClick={() => setIconDialogOpen(true)}>아이콘 변경</Button>
                  <Button as={Link} variant="secondary" size="sm" to="/app/profile/achievements">업적 보기</Button>
                </div>
              </div>
            </div>
            {emblemFeedback ? <small className="profile-icon-card-feedback">{emblemFeedback}</small> : null}
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">내 정보</p>
                <h2>{getUserHashtag(user)}</h2>
              </div>
            </div>
            <form className="form-grid profile-form-grid" onSubmit={submit}>
              <label>
                닉네임
                <input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
              </label>
              <ProfileBasicsFields
                position={draft.position}
                regionSido={draft.regionSido}
                regionDistrict={draft.regionDistrict}
                onPositionChange={(position) => update({ position })}
                onRegionChange={(regionSido, regionDistrict) => update({ regionSido, regionDistrict })}
              />
              {profileError ? <p className="form-warning">{profileError}</p> : null}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <AffiliationEditor user={user} affiliations={app.state.affiliations} actions={app.actions} />
          <section className="profile-rating-grid">
            <RatingCard className="profile-rating-primary" title="통합" mmr={user.ratings.integrated} ratings={user.ratings} />
            {isPlacementComplete(user.ratings) ? Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard className="profile-rating-mode" key={mode} title={mode} mmr={mmr} ratings={user.ratings} mode={mode} />
            )) : null}
          </section>
          <RecentRecordCard records={myRecords} userId={user.id} teams={app.state.teams} onOpenRecord={setSelectedRecordMatchId} loading={recordsPending} />
        </div>
        <aside className="page-stack profile-side-grid">
          <ProgressionChecklist user={user} matches={app.state.matches} />
          <ShareCard user={user} />
          <Card className="section-card">
            <div className="contract-grid single ui-design-borderless-list">
              <div>
                <span>신뢰도</span>
                <strong>{user.trustScore}</strong>
              </div>
              <div>
                <span>지역</span>
                <strong>{user.region}</strong>
              </div>
              <div>
                <span>평균 파울</span>
                <strong>{averageFouls.toFixed(1)}</strong>
              </div>
              <div>
                <span>소속</span>
                <strong>{user.affiliationName || "없음"}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
      {iconDialogOpen ? (
        <ProfileIconDialog
          user={user}
          actions={app.actions}
          onClose={() => setIconDialogOpen(false)}
          onSaved={() => setEmblemFeedback("프로필 아이콘을 저장했습니다.")}
        />
      ) : null}
      <MatchRoomModal app={app} matchId={selectedRecordMatchId} onClose={() => setSelectedRecordMatchId("")} />
    </div>
  );
}
