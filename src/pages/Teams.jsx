import { useEffect, useMemo, useState } from "react";
import { Crown, PlusCircle, Search, Shield, Swords } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { MAX_TEAM_MEMBERSHIPS, MAX_TEAM_NAME_LENGTH, REGIONS, getTeamRoleLabel } from "../lib/constants.js";
import { getCourtLayoutLabel, getCourtSurfaceLabel, getRegisteredCourts } from "../lib/courts.js";
import { getCourtHashtag, getTeamHashtag } from "../lib/handles.js";
import { getRepresentativeTeam } from "../lib/profileSetup.js";
import { getTierDivision } from "../lib/tier.js";

const allRegions = ["전체", ...REGIONS];

function compareTeamRank(a, b) {
  const aWinRate = a.played ? a.wins / a.played : 0;
  const bWinRate = b.played ? b.wins / b.played : 0;
  return b.mmr - a.mmr || bWinRate - aWinRate || b.played - a.played || a.name.localeCompare(b.name);
}

function getStoredTeamRecord(team) {
  const wins = Number(team.wins ?? 0);
  const losses = Number(team.losses ?? 0);
  const draws = Number(team.draws ?? 0);
  return { wins, losses, draws, played: wins + losses + draws };
}

function isHashtagQuery(query = "") {
  return query.trim().startsWith("#");
}

export default function Teams({ app }) {
  useEffect(() => {
    app.actions.loadDirectory?.();
  }, [app.actions]);
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const defaultHomeCourt = registeredCourts[0]?.name ?? "미정";
  const [draft, setDraft] = useState({ name: "", region: app.currentUser.region, homeCourt: defaultHomeCourt, captainId: app.currentUser.id, accent: "#58d2c0" });
  const [teamCreatePending, setTeamCreatePending] = useState(false);
  const [teamCreateError, setTeamCreateError] = useState("");
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(app.currentUser.region ?? "전체");
  const [courtQuery, setCourtQuery] = useState(defaultHomeCourt);
  const [courtRegion, setCourtRegion] = useState(app.currentUser.region ?? "전체");
  const favoriteTeamIds = app.state.settings?.favoriteTeamIds ?? [];
  const representativeTeamId = app.state.settings?.representativeTeamId ?? "";
  const favoriteCourtIds = app.state.settings?.favoriteCourtIds ?? [];
  const teamName = draft.name.trim().replace(/\s+/g, " ");
  const teamNameInvalid = !teamName || teamName.length > MAX_TEAM_NAME_LENGTH;
  const isFavoriteTeam = (team) => favoriteTeamIds.includes(team.id);
  const isFavoriteCourt = (court) => favoriteCourtIds.includes(court.id);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const teamCountByUser = useMemo(() => {
    const counts = new Map();
    app.state.teams.forEach((team) => {
      team.members.forEach((member) => counts.set(member.userId, (counts.get(member.userId) ?? 0) + 1));
    });
    return counts;
  }, [app.state.teams]);
  const selectedCaptainTeamCount = teamCountByUser.get(app.currentUser.id) ?? 0;
  const captainLimitReached = selectedCaptainTeamCount >= MAX_TEAM_MEMBERSHIPS;
  const rankingTeams = useMemo(() => {
    return app.state.teams
      .map((team) => ({ ...team, ...getStoredTeamRecord(team) }))
      .sort(compareTeamRank)
      .map((team, index) => ({ ...team, rank: index + 1 }));
  }, [app.state.teams]);
  const topTeam = rankingTeams[0];
  const myTeams = useMemo(() => {
    return rankingTeams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => ({ ...team, myRole: team.members.find((member) => member.userId === app.currentUser.id)?.role ?? "regular" }))
      .sort((a, b) => Number(b.myRole === "captain") - Number(a.myRole === "captain") || a.rank - b.rank);
  }, [app.currentUser.id, rankingTeams]);
  const representativeTeam = useMemo(
    () => getRepresentativeTeam(app.currentUser.id, myTeams, representativeTeamId),
    [app.currentUser.id, myTeams, representativeTeamId],
  );
  const teamDirectoryError = app.directoryStatus?.error ?? "";
  const teamDirectoryPending = app.remoteReady === false || app.directoryStatus?.loading || (app.directoryStatus?.loaded === false && !teamDirectoryError);
  const myTeamCountPending = teamDirectoryPending && !myTeams.length;
  const myTeamCountLabel = myTeamCountPending ? "..." : `${myTeams.length}/${MAX_TEAM_MEMBERSHIPS}`;
  const myTeamCountTone = myTeamCountPending ? "neutral" : myTeams.length > MAX_TEAM_MEMBERSHIPS ? "orange" : myTeams.length ? "green" : "neutral";
  const favoriteTeams = useMemo(() => {
    return rankingTeams
      .filter(isFavoriteTeam)
      .slice(0, 10);
  }, [favoriteTeamIds, rankingTeams]);
  const visibleCourts = useMemo(() => {
    const keyword = courtQuery.trim().toLowerCase();
    return registeredCourts
      .filter((court) => courtRegion === "전체" || court.region === courtRegion)
      .filter((court) => `${court.name} ${getCourtHashtag(court)} ${court.region} ${court.type} ${court.addressText ?? ""}`.toLowerCase().includes(keyword))
      .sort((a, b) => Number(isFavoriteCourt(b)) - Number(isFavoriteCourt(a)) || Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name));
  }, [app.currentUser.region, courtQuery, courtRegion, favoriteCourtIds, registeredCourts]);
  const favoriteCourts = useMemo(() => {
    return registeredCourts
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [app.currentUser.region, favoriteCourtIds, registeredCourts]);
  const visibleTeams = useMemo(() => {
    const hashtagSearch = isHashtagQuery(query);
    return rankingTeams
      .filter((team) => hashtagSearch || region === "전체" || team.region === region)
      .filter((team) => `${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`.toLowerCase().includes(query.trim().toLowerCase()));
  }, [query, rankingTeams, region]);
  const renderTeamSearchItem = (team) => (
    <button
      key={team.id}
      type="button"
      className="search-picker-result-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setRegion(team.region);
        setQuery(team.name);
      }}
    >
      <strong>{team.name}</strong>
      <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
      <em>{getTeamHashtag(team)} · {isFavoriteTeam(team) ? "즐겨찾기" : "팀"}</em>
    </button>
  );
  const selectCourt = (court) => {
    update({ homeCourt: court.name });
    setCourtQuery(court.name);
    setCourtRegion(court.region);
  };
  const renderCourtSearchItem = (court) => (
    <button
      key={court.id}
      type="button"
      className={draft.homeCourt === court.name ? "search-picker-result-row selected" : "search-picker-result-row"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => selectCourt(court)}
    >
      <strong>{court.name}</strong>
      <span>{court.region} · {court.type} · {getCourtSurfaceLabel(court)} · {getCourtLayoutLabel(court)}</span>
      <em>{getCourtHashtag(court)} · {isFavoriteCourt(court) ? "즐겨찾기" : "구장"}</em>
    </button>
  );

  const submit = async (event) => {
    event.preventDefault();
    if (teamNameInvalid) return;
    setTeamCreatePending(true);
    setTeamCreateError("");
    try {
      const result = await app.actions.createTeam({ ...draft, captainId: app.currentUser.id });
      if (!result || result?.ok === false) {
        setTeamCreateError(result?.message || result?.error || "팀을 만들지 못했습니다.");
        return;
      }
      setDraft({ name: "", region: app.currentUser.region, homeCourt: defaultHomeCourt, captainId: app.currentUser.id, accent: "#58d2c0" });
      setCourtQuery(defaultHomeCourt);
      setCourtRegion(app.currentUser.region ?? "전체");
    } catch (error) {
      setTeamCreateError(error?.message || "팀을 만들지 못했습니다.");
    } finally {
      setTeamCreatePending(false);
    }
  };

  return (
    <div className="page-stack teams-page">
      {teamDirectoryPending ? <BasketballLoader overlay label="팀 맞추는 중" /> : null}
      <section className="team-hub-hero">
        <div>
          <p className="eyebrow">Squad House</p>
          <h1>팀 허브</h1>
          <p>내 팀 관리, 팀 탐색, 전체 팀 랭킹을 한 화면에서 확인합니다.</p>
        </div>
        <div className="team-hub-board">
          <span><Crown size={18} /> 전체 1위 팀</span>
          <TeamHoverCard team={topTeam} as="span"><strong>{topTeam?.name}</strong></TeamHoverCard>
          <em>{topTeam?.mmr} MMR · {topTeam?.wins}승 {topTeam?.losses}패 · {topTeam?.played}경기</em>
          <div>
            <span><Shield size={16} /> MMR 우선</span>
            <span><Swords size={16} /> 승률 보정</span>
          </div>
        </div>
      </section>

      <section className="team-overview-grid">
        <Card className="section-card my-team-management-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">My Teams</p>
              <h2>내 팀 관리</h2>
            </div>
            <Badge tone={myTeamCountTone}>{myTeamCountLabel}</Badge>
          </div>
          <div className="my-team-list">
            {myTeams.length ? myTeams.map((team) => {
              const winRate = team.played ? Math.round((team.wins / team.played) * 100) : 0;
              const isCaptain = team.myRole === "captain";
              const isRepresentative = representativeTeam?.id === team.id;
              const isExplicitRepresentative = representativeTeamId === team.id;
              return (
                <TeamHoverCard key={team.id} team={team} as="span" className="my-team-row" directNavigation to={`/app/teams/${team.id}${isCaptain ? "#team-control" : ""}`}>
                  <span className="team-rank-chip">#{team.rank}</span>
                  <TeamEmblem team={team} size="xs" />
                  <strong>{team.name}</strong>
                  <em>{getTeamRoleLabel(team.myRole)} · {team.mmr} MMR · {winRate}%</em>
                  <span className="my-team-tier">
                    <img src={getTierEmblemSrc(team.mmr)} alt={`${getTierDivision(team.mmr)} emblem`} loading="lazy" />
                    <span>{getTierDivision(team.mmr)}</span>
                  </span>
                  <Button
                    className="my-team-representative-button"
                    disabled={isExplicitRepresentative}
                    size="sm"
                    variant={isRepresentative ? "primary" : "secondary"}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!isExplicitRepresentative) app.actions.updateSettings({ representativeTeamId: team.id });
                    }}
                  >
                    {isRepresentative ? "대표팀" : "대표 설정"}
                  </Button>
                  <b>{isCaptain ? "관리" : "상세"}</b>
                </TeamHoverCard>
              );
            }) : myTeamCountPending ? (
              <div className="empty-state">팀 정보 확인 중</div>
            ) : teamDirectoryError ? (
              <div className="empty-state">팀 정보를 불러오지 못했습니다.</div>
            ) : (
              <div className="empty-state">소속 팀이 없습니다. 오른쪽에서 팀을 만들거나 모집에 지원하세요.</div>
            )}
          </div>
        </Card>

        <Card className="section-card team-rank-rule-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Ranking Rule</p>
              <h2>랭킹 기준</h2>
            </div>
          </div>
          <div className="rank-rule-list">
            <div><strong>1</strong><span>팀 MMR 높은 순</span></div>
            <div><strong>2</strong><span>동률이면 확정 경기 승률</span></div>
            <div><strong>3</strong><span>그래도 같으면 확정 경기수</span></div>
          </div>
          <p className="team-ranking-note">즐겨찾기와 지역 필터는 탐색용입니다. 순위 번호는 전체 랭킹 기준으로 고정됩니다.</p>
        </Card>
      </section>

      <Card className="section-card selector-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Team Ranking</p>
            <h2>팀 검색과 지역 정렬</h2>
          </div>
          <Search size={22} />
        </div>
        <div className="search-controls">
          <label>
            지역
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              {allRegions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="favorite-search-label">
            <span>팀명/홈코트</span>
            <SearchPicker
              value={query}
              onChange={setQuery}
              placeholder="Noeul, 마포, 한강..."
              items={visibleTeams}
              remoteSearchType="team"
              idleItems={favoriteTeams}
              idleTitle="즐겨찾기 팀"
              showIdleOnFocus
              floating
              closeOnResultClick
              renderItem={renderTeamSearchItem}
            />
          </div>
        </div>
      </Card>

      <div className="content-grid">
        <section className="card-grid">
          {visibleTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              users={app.state.users}
              teams={app.state.teams}
              rank={team.rank}
            />
          ))}
        </section>
        <Card className="section-card team-create-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Create Squad</p>
              <h2>새 팀 만들기</h2>
            </div>
            <PlusCircle size={22} />
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>
              팀 이름
              <input
                value={draft.name}
                maxLength={MAX_TEAM_NAME_LENGTH}
                onChange={(event) => update({ name: event.target.value.slice(0, MAX_TEAM_NAME_LENGTH) })}
              />
              <span className={teamNameInvalid ? "form-warning" : "form-chip"}>
                {teamName.length}/{MAX_TEAM_NAME_LENGTH}자
              </span>
            </label>
            <label>
              지역
              <select value={draft.region} onChange={(event) => {
                update({ region: event.target.value });
                setCourtRegion(event.target.value);
              }}>
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              홈 코트
              <SearchPicker
                value={courtQuery}
                onChange={setCourtQuery}
                placeholder="구장 이름, 지역, 해시태그"
                items={visibleCourts}
                remoteSearchType="court"
                idleItems={favoriteCourts.length ? favoriteCourts : visibleCourts.slice(0, 10)}
                idleTitle={favoriteCourts.length ? "즐겨찾기 구장" : "추천 구장"}
                showIdleOnFocus
                floating
                closeOnResultClick
                renderItem={renderCourtSearchItem}
              />
              <span className="form-chip">{draft.homeCourt}</span>
            </label>
            <label>
              팀장
              <input value={`${app.currentUser.name} · ${selectedCaptainTeamCount}/${MAX_TEAM_MEMBERSHIPS}팀`} readOnly disabled />
              <span className={captainLimitReached ? "form-warning" : "form-chip"}>
                팀 생성자는 팀장으로 고정됩니다.
              </span>
            </label>
            <label>
              팀 컬러
              <input type="color" value={draft.accent} onChange={(event) => update({ accent: event.target.value })} />
            </label>
            {teamCreateError ? <span className="form-warning">{teamCreateError}</span> : null}
            <Button type="submit" disabled={captainLimitReached || teamNameInvalid || teamCreatePending}><PlusCircle size={18} /> {teamCreatePending ? "저장 중" : "팀 만들기"}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
