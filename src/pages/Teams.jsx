import { useEffect, useMemo, useState } from "react";
import { PlusCircle, Search } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getTeamDiscoveryGroups } from "../data/teamMappers.js";
import { MAX_TEAM_MEMBERSHIPS, MAX_TEAM_NAME_LENGTH, REGIONS, getCanonicalRegion, getTeamRoleLabel, isSameRegion } from "../lib/constants.js";
import { getCourtAddress, getCourtLayoutLabel, getCourtPickerResults, getCourtSearchText, getCourtSurfaceLabel, getRegisteredCourts, mergeCourtSearchCourts } from "../lib/courts.js";
import { getCourtHashtag, getTeamHashtag } from "../lib/handles.js";
import { getRepresentativeTeam } from "../lib/profileSetup.js";
import { DIRECTORY_TEAM_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { getTierDivision } from "../lib/tier.js";

const TEAM_DISCOVERY_VIEW = "추천";
const TEAM_SEARCH_RESULT_LIMIT = 15;

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
  const loadDirectory = app.actions.loadDirectory;
  const directoryCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const [discoveredCourts, setDiscoveredCourts] = useState([]);
  const registeredCourts = useMemo(
    () => mergeCourtSearchCourts(directoryCourts, discoveredCourts),
    [directoryCourts, discoveredCourts],
  );
  const defaultHomeCourt = registeredCourts[0]?.name ?? "미정";
  const canonicalUserRegion = getCanonicalRegion(app.currentUser.region);
  const defaultTeamRegion = REGIONS.includes(canonicalUserRegion) ? canonicalUserRegion : REGIONS[0];
  const [draft, setDraft] = useState({ name: "", region: defaultTeamRegion, homeCourt: defaultHomeCourt, captainId: app.currentUser.id, accent: "#58d2c0" });
  const [teamCreatePending, setTeamCreatePending] = useState(false);
  const [teamCreateError, setTeamCreateError] = useState("");
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(TEAM_DISCOVERY_VIEW);
  const [courtQuery, setCourtQuery] = useState("");
  const [courtRegion, setCourtRegion] = useState(defaultTeamRegion);
  const directoryFilter = query.trim();
  const directoryRegion = isHashtagQuery(query) || region === TEAM_DISCOVERY_VIEW ? "" : region;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDirectory?.({
        kind: "teams",
        filter: directoryFilter,
        region: directoryRegion,
        limit: DIRECTORY_TEAM_PAGE_LIMIT,
        offset: 0,
        includeTeamMemberProfiles: true,
      });
    }, directoryFilter ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [directoryFilter, directoryRegion, loadDirectory]);
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
  const teamDiscoveryGroups = useMemo(() => getTeamDiscoveryGroups({
    teams: rankingTeams,
    users: app.state.users,
    currentUser: app.currentUser,
    ownTeamIds: myTeams.map((team) => team.id),
    referenceTeam: representativeTeam,
  }), [app.currentUser, app.state.users, myTeams, rankingTeams, representativeTeam]);
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
  const visibleCourts = useMemo(() => getCourtPickerResults(registeredCourts, {
    query: courtQuery,
    region: courtRegion,
    currentRegion: app.currentUser.region,
    favoriteCourtIds,
  }), [app.currentUser.region, courtQuery, courtRegion, favoriteCourtIds, registeredCourts]);
  const favoriteCourts = useMemo(() => {
    return registeredCourts
      .filter(isFavoriteCourt)
      .sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [app.currentUser.region, favoriteCourtIds, registeredCourts]);
  const visibleTeams = useMemo(() => {
    const hashtagSearch = isHashtagQuery(query);
    const selectedRegion = region === TEAM_DISCOVERY_VIEW ? "" : region;
    return rankingTeams
      .filter((team) => hashtagSearch || !selectedRegion || isSameRegion(team.region, selectedRegion))
      .filter((team) => `${team.name} ${getTeamHashtag(team)} ${team.region} ${team.homeCourt}`.toLowerCase().includes(query.trim().toLowerCase()));
  }, [query, rankingTeams, region]);
  const searchViewActive = Boolean(query.trim()) || region !== TEAM_DISCOVERY_VIEW;
  const searchResultTeams = visibleTeams.slice(0, TEAM_SEARCH_RESULT_LIMIT);
  const currentRegionLabel = defaultTeamRegion || "내 지역";
  const discoverySections = [
    { id: "nearby", title: `${currentRegionLabel} 주변 팀`, teams: teamDiscoveryGroups.nearby },
    { id: "rivals", title: "라이벌 팀", teams: teamDiscoveryGroups.rivals },
    { id: "affiliation", title: "같은 소속 팀", teams: teamDiscoveryGroups.affiliation },
  ].filter((section) => section.teams.length);
  const renderTeamSearchItem = (team) => (
    <button
      key={team.id}
      type="button"
      className="search-picker-result-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const canonicalRegion = getCanonicalRegion(team.region);
        setRegion(REGIONS.includes(canonicalRegion) ? canonicalRegion : TEAM_DISCOVERY_VIEW);
        setQuery(team.name);
      }}
    >
      <strong>{team.name}</strong>
      <span>{team.region} · {team.mmr} MMR · {team.homeCourt}</span>
      <em>{getTeamHashtag(team)} · {isFavoriteTeam(team) ? "즐겨찾기" : "팀"}</em>
    </button>
  );
  const selectCourt = (court) => {
    if (court?.id && !registeredCourts.some((item) => item.id === court.id)) {
      setDiscoveredCourts((current) => [...current.filter((item) => item.id !== court.id), court]);
    }
    update({ homeCourt: court.name });
    setCourtQuery("");
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
      <span className="court-search-result-address">{getCourtAddress(court)}</span>
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
        setTeamCreateError("팀을 만들지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      setDraft({ name: "", region: defaultTeamRegion, homeCourt: defaultHomeCourt, captainId: app.currentUser.id, accent: "#58d2c0" });
      setCourtQuery("");
      setCourtRegion(defaultTeamRegion);
    } catch (error) {
      setTeamCreateError("팀을 만들지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setTeamCreatePending(false);
    }
  };

  return (
    <div className="page-stack teams-page">
      {teamDirectoryPending ? <BasketballLoader overlay label="팀 맞추는 중" /> : null}
      <section className="team-hub-hero">
        <div>
          <p className="eyebrow">Team Hub</p>
          <h1>팀</h1>
        </div>
        {representativeTeam ? (
          <div className="team-hub-board ui-liquid-glass">
            <div className="team-hub-board-head">
              <span>대표팀</span>
              <b>#{representativeTeam.rank}</b>
            </div>
            <div className="team-hub-board-identity">
              <div>
                <TeamHoverCard team={representativeTeam} as="span" className="team-hub-board-name">
                  <strong>{representativeTeam.name}</strong>
                </TeamHoverCard>
                <em>{representativeTeam.region} · {representativeTeam.homeCourt}</em>
              </div>
            </div>
            <div className="team-hub-board-stats">
              <span><b>{representativeTeam.mmr}</b><em>MMR</em></span>
              <span><b>{representativeTeam.wins}승 {representativeTeam.losses}패</b><em>전적</em></span>
              <span><b>{representativeTeam.members.length}명</b><em>팀원</em></span>
            </div>
          </div>
        ) : null}
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
                  <span className="my-team-copy">
                    <strong>{team.name}</strong>
                    <em>{getTeamRoleLabel(team.myRole)} · {team.mmr} MMR · {winRate}%</em>
                  </span>
                  <span className="my-team-actions">
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
                  </span>
                </TeamHoverCard>
              );
            }) : myTeamCountPending ? (
              <div className="ui-empty-state-compact">팀 정보 확인 중</div>
            ) : teamDirectoryError ? (
              <div className="ui-empty-state-compact">팀 정보를 불러오지 못했습니다.</div>
            ) : (
              <div className="ui-empty-state-compact">소속 팀이 없습니다. 새 팀을 만들거나 팀 모집에 지원해 주세요.</div>
            )}
          </div>
        </Card>

        <Card className="section-card team-search-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Find Teams</p>
              <h2>팀 찾기</h2>
            </div>
            <Search size={22} />
          </div>
          <div className="search-controls">
            <label>
              팀 보기
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value={TEAM_DISCOVERY_VIEW}>추천</option>
                {REGIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="favorite-search-label">
              <span>팀 검색</span>
              <SearchPicker
                value={query}
                onChange={setQuery}
                placeholder="팀명, 홈코트, 해시태그"
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
      </section>

      <div className="content-grid">
        <div className="team-discovery-stack">
          {searchViewActive ? (
            <section className="team-discovery-section">
              <div className="section-title-row">
                <h2>{query.trim() ? "검색 결과" : `${region} 팀`}</h2>
                <Badge tone="neutral">{searchResultTeams.length}</Badge>
              </div>
              {searchResultTeams.length ? (
                <div className="card-grid">
                  {searchResultTeams.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      users={app.state.users}
                      teams={app.state.teams}
                      rank={team.rank}
                    />
                  ))}
                </div>
              ) : (
                <div className="ui-empty-state-compact">조건에 맞는 팀이 없습니다.</div>
              )}
            </section>
          ) : discoverySections.length ? discoverySections.map((section) => (
            <section className="team-discovery-section" key={section.id}>
              <div className="section-title-row">
                <h2>{section.title}</h2>
                <Badge tone="neutral">{section.teams.length}</Badge>
              </div>
              <div className="card-grid">
                {section.teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    users={app.state.users}
                    teams={app.state.teams}
                    rank={team.rank}
                  />
                ))}
              </div>
            </section>
          )) : (
            <div className="ui-empty-state-compact">추천할 팀이 아직 없습니다.</div>
          )}
        </div>
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
                placeholder="구장 이름, 주소, 지역, 해시태그"
                items={visibleCourts}
                remoteSearchType="court"
                getSearchText={getCourtSearchText}
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
