import { CalendarDays, ChevronRight, Flag, MapPin, Save, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import {
  getMatchTime,
  isTournamentForfeitAvailable,
  isTournamentScheduleEditable,
  getTournamentSchedulePolicyLabel,
  getLeagueMatchResult,
  getLeagueFixtureState,
  renderBracketNode,
} from "./tournamentDetailModel.jsx";

export function TournamentCompetitionSection({ controller }) {
  const { app, tournament, scheduleDialog, setScheduleDialog, savingScheduleId, forfeitDialog, setForfeitDialog, savingForfeitId, selectedMatchId, setSelectedMatchId, editingScheduleId, setEditingScheduleId, refereeQuery, setRefereeQuery, governanceAction, governanceFeedback, teamById, userById, matchesById, tournamentMatches, teamRows, acceptedCount, hasPendingTeamApprovals, governanceEnabled, requiredRefereeCount, acceptedRefereeIds, refereeRows, eligibleRefereeCandidates, canInviteReferee, canReviewRegion, canStartCommunity, verticalBracket, championTeam, canManageSchedule, todayValue, maxScheduleDate, leagueFixtures, leagueMatchesByFixture, leagueStandings, tournamentCourts, saveSchedule, confirmSchedule, confirmForfeit, runGovernanceAction, saveMatchReferee, renderRefereeInviteItem, organizer, dialogMatch, forfeitMatch, matchesReturnTo } = controller;
  return (
      <section className="tournament-section">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{tournament.format === "tournament" ? "BRACKET" : "LEAGUE FIXTURES"}</span>
            <h2>{tournament.format === "tournament" ? "대진표" : "리그 경기표"}</h2>
          </div>
          <span>{tournament.status === "draft" ? "대기" : `${tournamentMatches.length}경기`}</span>
        </div>

        {tournament.status === "draft" ? (
          <div className="tournament-empty">
            <strong>대진 생성 전</strong>
            <p>
              {governanceEnabled
                ? "팀장·심판 승인 후 지역 승인 또는 지역 비승인 개최를 선택하면 경기와 대진이 생성됩니다."
                : "초대팀 주장이 모두 승인하면 경기와 대진이 자동으로 생성됩니다."}
            </p>
          </div>
        ) : tournament.format === "tournament" ? (
          <div className="tournament-bracket tournament-vertical-bracket" style={{ "--bracket-slots": verticalBracket.baseSlots }}>
            <div className="vertical-bracket-title">
              <span>우승</span>
              <strong>{championTeam ? <TeamHoverCard team={championTeam} as="span">{championTeam.name}</TeamHoverCard> : "결승 승자"}</strong>
            </div>
            <div className="vertical-bracket-trophy">
              <Trophy size={42} />
            </div>
            <div className="vertical-bracket-rows">
              {verticalBracket.rounds.map((round) => (
                <div key={round.id} className="vertical-bracket-row">
                  <h3>{round.name}</h3>
                  <div className="vertical-bracket-lanes">
                    {round.nodes.map(({ node, gridColumn }) => (
                      <div key={node.id} className="vertical-bracket-node" style={{ gridColumn }}>
                        {renderBracketNode(node, teamById, setSelectedMatchId)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="league-layout">
            <div className="league-standings-panel">
              <div className="league-panel-head">
                <strong>현재 순위</strong>
                <span>승수 · 득실차 · 득점 순</span>
              </div>
              <div className="league-table-scroll">
                <table className="league-table">
                  <thead>
                    <tr><th>순위</th><th>팀</th><th>경기</th><th>승</th><th>패</th><th>득실</th></tr>
                  </thead>
                  <tbody>
                    {leagueStandings.map((row, index) => (
                      <tr key={row.teamId} className={index === 0 && row.played ? "leader" : ""}>
                        <td>{index + 1}</td>
                        <td><TeamHoverCard team={row.team}>{row.team.name}</TeamHoverCard></td>
                        <td>{row.played}</td>
                        <td>{row.wins}</td>
                        <td>{row.losses}</td>
                        <td>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="league-fixtures-panel">
              <div className="league-panel-head">
                <strong>경기 일정·결과</strong>
                <span>{leagueFixtures.length}경기</span>
              </div>
              <div className="league-fixture-grid">
                {leagueFixtures.map((fixture) => {
                  const match = matchesById[fixture.matchId] ?? leagueMatchesByFixture.get(Number(fixture.fixture));
                  const openMatchId = match?.id ?? fixture.matchId ?? "";
                  const result = getLeagueMatchResult(match);
                  const fixtureState = getLeagueFixtureState(match, openMatchId);
                  const teamA = teamById[match?.teamA?.teamId] ?? teamById[fixture.teamAId];
                  const teamB = teamById[match?.teamB?.teamId] ?? teamById[fixture.teamBId];
                  const teamAName = match?.teamA?.name ?? teamA?.name ?? "TBD";
                  const teamBName = match?.teamB?.name ?? teamB?.name ?? "TBD";
                  const matchCourt = tournamentCourts.find((court) => court.id === match?.courtId);
                  const courtName = match?.court ?? match?.courtName ?? matchCourt?.name ?? tournament.court ?? "구장 미정";
                  const losingSide = match?.forfeitSide || match?.rules?.forfeit?.losingSide || "";
                  const losingTeamName = losingSide === "teamA" ? teamAName : losingSide === "teamB" ? teamBName : "";
                  return (
                    <form
                      key={fixture.matchId || `${fixture.fixture}-${fixture.teamAId}-${fixture.teamBId}`}
                      className={`league-fixture-card${result ? " completed" : ""}${openMatchId ? " openable" : " pending"}`}
                      onSubmit={(event) => match?.id && saveSchedule(event, match.id)}
                    >
                      <button
                        type="button"
                        className="league-fixture-summary"
                        disabled={!openMatchId}
                        title={openMatchId ? "경기 방 보기" : "경기 생성 후 방을 열 수 있습니다."}
                        aria-label={`${fixture.fixture}경기 ${teamAName} 대 ${teamBName}${openMatchId ? " 방 보기" : " 경기 생성 전"}`}
                        onClick={() => openMatchId && setSelectedMatchId(openMatchId)}
                      >
                        <span className="league-fixture-topline">
                          <span className="league-fixture-round">{fixture.fixture}경기</span>
                          <Badge tone={fixtureState.tone} className="league-fixture-status">{fixtureState.label}</Badge>
                        </span>
                        <span className="league-fixture-matchup">
                          <strong title={teamAName}>{teamAName}</strong>
                          <b>{result ? `${result.scoreA}:${result.scoreB}` : "VS"}</b>
                          <strong title={teamBName}>{teamBName}</strong>
                        </span>
                        <span className="league-fixture-meta">
                          <span><CalendarDays size={14} />{match ? getMatchTime(match) : "일정 미정"}</span>
                          <span><MapPin size={14} />{courtName}</span>
                          {losingTeamName ? <span className="league-fixture-forfeit"><Flag size={14} />{losingTeamName} 불참 · 1:0 몰수</span> : null}
                        </span>
                      </button>
                      <div className="league-fixture-actions">
                        {openMatchId ? (
                          <button type="button" className="league-fixture-open" onClick={() => setSelectedMatchId(openMatchId)}>
                            방 보기 <ChevronRight size={16} />
                          </button>
                        ) : (
                          <span className="league-fixture-pending">생성 전</span>
                        )}
                        {canManageSchedule && match && !result ? (
                          isTournamentScheduleEditable(match) ? (
                            <button
                              type="button"
                              className="league-fixture-schedule-toggle"
                              aria-expanded={editingScheduleId === match.id}
                              onClick={() => setEditingScheduleId((current) => current === match.id ? "" : match.id)}
                            >
                              <CalendarDays size={14} />
                              {editingScheduleId === match.id ? "입력 닫기" : match.scheduledDate ? "일정 수정" : "일정 설정"}
                            </button>
                          ) : (
                            <span className="tournament-schedule-policy">{getTournamentSchedulePolicyLabel(match)}</span>
                          )
                        ) : null}
                      </div>
                      {canManageSchedule && match && !result && isTournamentScheduleEditable(match) && editingScheduleId === match.id ? (
                        <div className="tournament-inline-schedule">
                          <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} aria-label="경기 날짜" />
                          <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} aria-label="경기 시간" />
                          <select name="courtId" defaultValue={match.courtId ?? tournament.courtId ?? tournamentCourts[0]?.id} aria-label="경기 구장">
                            {tournamentCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
                          </select>
                          <button type="submit" disabled={savingScheduleId === match.id}><Save size={14} /> {savingScheduleId === match.id ? "저장 중" : "저장"}</button>
                          <button
                            type="button"
                            className="tournament-forfeit-button"
                            disabled={!isTournamentForfeitAvailable(match)}
                            title={isTournamentForfeitAvailable(match) ? "팀 불참 처리" : "경기 시작 시각 이후 사용 가능"}
                            onClick={() => setForfeitDialog({ mode: "choose", matchId: match.id })}
                          ><Flag size={14} /> 몰수</button>
                        </div>
                      ) : null}
                    </form>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
  );
}
