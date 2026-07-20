import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import { PLAYER_POSITIONS } from "../lib/constants.js";
import { getUserHashtag } from "../lib/handles.js";
import { getMatchSideScore as getSideScore, isDateWithinPastMonths, isPersonalRecordMatch } from "../lib/matchUtils.js";
import { PROFILE_ICON_CATALOG } from "../lib/profileIcons.js";
import { canChangeProfileName, getNextNameChangeDate, inferRegionSelection, REGION_TREE } from "../lib/profileSetup.js";
import { getTeamEmblemErrorMessage } from "../lib/teamEmblem.js";
import { MatchRoomModal } from "./Matches.jsx";

const POSITION_OPTIONS = PLAYER_POSITIONS.filter((position) => ["PG", "SG", "SF", "PF", "C"].includes(position));

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getUserSide(match, userId) {
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

function isRecordInDetailWindow(match) {
  const source = String(match.scheduledDate ?? match.scheduledAt ?? match.confirmedAt ?? match.createdAt ?? "");
  return isDateWithinPastMonths(source, 6);
}

function getUserResult(match, userId) {
  const sideName = getUserSide(match, userId);
  if (!sideName) return "D";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getUserRecordLine(match, userId) {
  const sideName = getUserSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

function getAverageFouls(matches = [], userId) {
  const confirmed = matches.filter((match) => match.status === "confirmed" && match.result && getUserSide(match, userId));
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

function getRecordMetaPrefix(match) {
  return isPersonalRecordMatch(match) ? "개인 기록 · " : "";
}

function RecentRecordCard({ records, userId, onOpenRecord, loading = false }) {
  return (
    <Card className="section-card profile-record-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Record</p>
          <h2>내 기록</h2>
        </div>
        <Link className="button button-secondary button-sm" to="/app/profile/records">기록 더보기</Link>
      </div>
      {loading ? (
        <div className="empty-state">기록 정리 중</div>
      ) : records.length ? (
        <div className="recent-match-list">
          {records.map((match) => {
            const line = getUserRecordLine(match, userId);
            return (
              <Link
                key={match.id}
                to={`/app/matches?match=${match.id}`}
                className={`recent-match-row result-${line.result.toLowerCase()}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenRecord(match.id);
                }}
              >
                <b>{line.result}</b>
                <span>
                  <strong>{line.side.name} vs {line.opponent.name}</strong>
                  <em>{getRecordMetaPrefix(match)}{match.scheduledAt} · {match.mode}</em>
                </span>
                <i>{line.score}:{line.opponentScore}</i>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">확정된 경기 기록이 없습니다.</div>
      )}
    </Card>
  );
}

export default function Profile({ app }) {
  const user = app.currentUser;
  const inferredRegion = inferRegionSelection([user.regionSido, user.regionDistrict, user.region].filter(Boolean).join(" "));
  const [draft, setDraft] = useState({
    name: user.name ?? "",
    position: POSITION_OPTIONS.includes(user.position) ? user.position : "PG",
    regionSido: inferredRegion.sido,
    regionDistrict: inferredRegion.district,
    school: user.school ?? "",
    company: user.company ?? "",
  });
  const [profileError, setProfileError] = useState("");
  const [selectedRecordMatchId, setSelectedRecordMatchId] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [emblemPending, setEmblemPending] = useState(false);
  const [emblemFeedback, setEmblemFeedback] = useState("");
  const [emblemStyleDraft, setEmblemStyleDraft] = useState(() => ({
    avatarColor: user.avatarColor ?? "#58d2c0",
    avatarBorderEnabled: user.avatarBorderEnabled === true,
    avatarBorderColor: user.avatarBorderColor ?? user.avatarColor ?? "#58d2c0",
  }));
  const recordsLoadKeyRef = useRef("");
  const avatarSource = new Set(["discord", "icon"]).has(user.avatarSource) ? user.avatarSource : "initial";
  const hasDiscordAvatar = Boolean(user.discordAvatarUrl || user.discordConnection?.avatarUrl);
  const selectedRegion = REGION_TREE.find((item) => item.sido === draft.regionSido) ?? REGION_TREE[0];
  const districtOptions = useMemo(() => selectedRegion.districts, [selectedRegion]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    setEmblemStyleDraft({
      avatarColor: user.avatarColor ?? "#58d2c0",
      avatarBorderEnabled: user.avatarBorderEnabled === true,
      avatarBorderColor: user.avatarBorderColor ?? user.avatarColor ?? "#58d2c0",
    });
  }, [user.avatarBorderColor, user.avatarBorderEnabled, user.avatarColor, user.id]);

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
        school: draft.school,
        company: draft.company,
      });
    } catch (error) {
      setProfileError(error.message || "프로필 저장에 실패했습니다.");
    }
  };
  const saveEmblemStyle = async () => {
    if (emblemPending) return;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.updateProfileEmblemStyle(emblemStyleDraft);
      setEmblemFeedback(result?.ok === false ? getTeamEmblemErrorMessage(result.error) : "프로필 아이콘 설정을 저장했습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const selectAvatarSource = async (nextSource) => {
    if (emblemPending || nextSource === avatarSource) return;
    if (nextSource === "discord" && !hasDiscordAvatar) {
      setEmblemFeedback("먼저 설정에서 Discord 계정을 연결하세요.");
      return;
    }
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.setProfileEmblemSource(nextSource);
      setEmblemFeedback(result?.ok === false ? getTeamEmblemErrorMessage(result.error) : "프로필 아이콘을 변경했습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const selectProfileIcon = async (avatarIconKey) => {
    if (emblemPending) return;
    setEmblemPending(true);
    setEmblemFeedback("");
    try {
      const result = await app.actions.selectProfileIcon(avatarIconKey);
      setEmblemFeedback(result?.ok === false ? getTeamEmblemErrorMessage(result.error) : "프로필 아이콘을 변경했습니다.");
    } catch (error) {
      setEmblemFeedback(getTeamEmblemErrorMessage(error?.code || error?.message));
    } finally {
      setEmblemPending(false);
    }
  };
  const myRecords = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id) && isRecordInDetailWindow(match))
    .sort(compareRecent)
    .slice(0, 6);
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>프로필</h1>
        </div>
        <Link className="button button-secondary" to="/app/signup">가입 정보 설정</Link>
      </header>
      <div className="content-grid profile-overview-grid">
        <div className="page-stack profile-main-stack">
          <Card className="section-card profile-emblem-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">My Icon</p>
                <h2>프로필 아이콘</h2>
              </div>
              <ProfileEmblem user={{ ...user, ...emblemStyleDraft, avatarSource }} className="hero-avatar" />
            </div>
            <div className="emblem-source-grid profile-icon-source-grid">
              <button type="button" className={avatarSource === "initial" ? "active" : ""} aria-pressed={avatarSource === "initial"} disabled={emblemPending} onClick={() => selectAvatarSource("initial")}>
                <strong>기본값</strong>
              </button>
              <button type="button" className={avatarSource === "discord" ? "active" : ""} aria-pressed={avatarSource === "discord"} disabled={emblemPending || !hasDiscordAvatar} onClick={() => selectAvatarSource("discord")}>
                <strong>Discord</strong>
              </button>
              <button
                type="button"
                className={avatarSource === "icon" ? "active" : ""}
                aria-pressed={avatarSource === "icon"}
                disabled={emblemPending || !PROFILE_ICON_CATALOG.some((icon) => icon.unlocked)}
                onClick={() => selectProfileIcon(user.avatarIconKey || PROFILE_ICON_CATALOG.find((icon) => icon.unlocked)?.id)}
              >
                <strong>아이콘</strong>
              </button>
            </div>
            {avatarSource === "icon" ? (
              <div className="profile-icon-catalog" role="list" aria-label="해금된 프로필 아이콘">
                {PROFILE_ICON_CATALOG.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    role="listitem"
                    className={user.avatarIconKey === icon.id ? "active" : ""}
                    disabled={emblemPending || !icon.unlocked}
                    aria-pressed={user.avatarIconKey === icon.id}
                    onClick={() => selectProfileIcon(icon.id)}
                  >
                    <img src={icon.src} alt="" />
                    <span><strong>{icon.name}</strong><small>{icon.description}</small></span>
                  </button>
                ))}
              </div>
            ) : null}
            {avatarSource === "initial" ? <div className="emblem-style-controls">
              <label>
                기본 색
                <input type="color" value={emblemStyleDraft.avatarColor} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, avatarColor: event.target.value }))} />
              </label>
              <label className="emblem-border-toggle">
                <input type="checkbox" checked={emblemStyleDraft.avatarBorderEnabled} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, avatarBorderEnabled: event.target.checked }))} />
                테두리 사용
              </label>
              <label>
                테두리 색
                <input type="color" value={emblemStyleDraft.avatarBorderColor} disabled={!emblemStyleDraft.avatarBorderEnabled} onChange={(event) => setEmblemStyleDraft((current) => ({ ...current, avatarBorderColor: event.target.value }))} />
              </label>
              <Button type="button" size="sm" variant="secondary" disabled={emblemPending} onClick={saveEmblemStyle}>저장</Button>
            </div> : null}
            <p className="emblem-policy-note">직접 사진 업로드는 사용하지 않습니다. 검수된 아이콘만 제공하며 이후 업적으로 추가 해금됩니다.</p>
            <div className="settings-save-row">
              <small>{emblemFeedback || (avatarSource === "initial" ? "기본값 색상과 테두리를 바꿀 수 있습니다." : avatarSource === "discord" ? "연결된 Discord 프로필 사진을 사용합니다." : "해금된 아이콘을 사용합니다.")}</small>
            </div>
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
              <label>
                주 포지션
                <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                  {POSITION_OPTIONS.map((position) => <option key={position} value={position}>{position}</option>)}
                </select>
              </label>
              <label>
                시도
                <select value={draft.regionSido} onChange={(event) => update({ regionSido: event.target.value, regionDistrict: REGION_TREE.find((item) => item.sido === event.target.value)?.districts[0] ?? "" })}>
                  {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
                </select>
              </label>
              <label>
                시군구
                <select value={districtOptions.includes(draft.regionDistrict) ? draft.regionDistrict : districtOptions[0]} onChange={(event) => update({ regionDistrict: event.target.value })}>
                  {districtOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                </select>
              </label>
              <label>
                학교
                <input value={draft.school} onChange={(event) => update({ school: event.target.value })} />
              </label>
              <label>
                회사
                <input value={draft.company} onChange={(event) => update({ company: event.target.value })} />
              </label>
              {profileError ? <p className="form-warning">{profileError}</p> : null}
              <Button type="submit">저장</Button>
            </form>
          </Card>
          <section className="profile-rating-grid">
            <RatingCard className="profile-rating-primary" title="통합" mmr={user.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
              <RatingCard className="profile-rating-mode" key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>
          <RecentRecordCard records={myRecords} userId={user.id} onOpenRecord={setSelectedRecordMatchId} loading={recordsPending} />
        </div>
        <aside className="page-stack profile-side-grid">
          <ProgressionChecklist user={user} matches={app.state.matches} />
          <ShareCard user={user} />
          <Card className="section-card">
            <div className="contract-grid single">
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
                <span>학교</span>
                <strong>{user.school}</strong>
              </div>
              <div>
                <span>회사</span>
                <strong>{user.company}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
      <MatchRoomModal app={app} matchId={selectedRecordMatchId} onClose={() => setSelectedRecordMatchId("")} />
    </div>
  );
}
