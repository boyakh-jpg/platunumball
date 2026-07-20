import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ShieldCheck } from "lucide-react";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Card from "../components/common/Card.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import MatchListCard, { MatchListSummary } from "../components/match/MatchListCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getRegisteredCourts } from "../lib/courts.js";
import {
  cleanRoomTitle,
  getMatchHostPlayerId,
  getMatchPlayerIds,
  getMatchRecordWindow,
  getMatchReservePlayerIds,
  getMatchRoomPhase,
  getPlayerSideName,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomScheduleLabel,
  getRoomVisibilityLabel,
  getSafeMatchSide,
  getStatRecorderSides,
  isEligibleReferee,
  isMatchInPlayMenu,
  isMatchPartyTeamParty,
  isMatchReferee,
  isMatchSideTeamParty,
} from "../lib/matchUtils.js";
import { SIDE_LABEL_TEXT as sideLabels } from "../lib/constants.js";
import { MatchRoomModal } from "./Matches.jsx";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";
import "../styles/match-list-card.css";

const statusMeta = {
  approval: { label: "승인", tone: "orange" },
  disputed: { label: "이의", tone: "orange" },
};

const activeStatuses = new Set(["agreed", "approval", "disputed"]);
const GENERIC_ROOM_TITLE_PATTERN = /^(경기|매치|농구|대기방|기록방|방)$/i;

function canAccessActiveMatch(match, user, state) {
  if (!activeStatuses.has(match.status) || !isMatchInPlayMenu(match)) return false;
  const sourcePost = match?.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  const isHost = getMatchHostPlayerId(match, sourcePost) === user.id;
  const isReferee = isMatchReferee(match, user.id) && isEligibleReferee(user, match.refereeTrustMin, state.settings?.refereeAppointments);
  const isRecorder = !match.refereeId && getStatRecorderSides(match, user.id).length > 0;
  const isPlayer = getMatchPlayerIds(match).includes(user.id);
  const isReserve = ["teamA", "teamB"].some((sideName) => getMatchReservePlayerIds(match, sideName).includes(user.id));
  return isHost || isReferee || isRecorder || isPlayer || isReserve;
}

function getRoleText(match, user, recorderSides) {
  if (isMatchReferee(match, user.id)) return "심판";
  if (recorderSides.length) return `${recorderSides.map((sideName) => sideLabels[sideName]).join(", ")} 기록자`;
  const playerSide = getPlayerSideName(match, user.id);
  if (playerSide) return `${sideLabels[playerSide]} 선수`;
  const reserveSide = ["teamA", "teamB"].find((sideName) => getMatchReservePlayerIds(match, sideName).includes(user.id));
  if (reserveSide) return `${sideLabels[reserveSide]} 후보`;
  return "경기 관계자";
}

function normalizeMatchupText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/\s+vs\s+/i, " vs ")
    .trim()
    .toLowerCase();
}

function getRecorderCardTitle(match) {
  const title = cleanRoomTitle(match.title, "")
    .replace(/^(정규전|친선전)\s+(1v1|2v2|3v3|5v5)\s*/i, "")
    .replace(/\s+(1v1|2v2|3v3|5v5)$/i, "")
    .trim();
  const matchupTitle = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  if (matchupTitle && normalizeMatchupText(title) === normalizeMatchupText(matchupTitle)) return "";
  if (GENERIC_ROOM_TITLE_PATTERN.test(title)) return "";
  return title;
}

function getRoomTypeLabel(match = {}) {
  const matchTeamCount = ["teamA", "teamB"].filter((sideName) => Boolean(match?.[sideName]?.teamId) || isMatchSideTeamParty(match, sideName)).length;
  const matchPartyCount = (match.parties ?? []).filter((party) => isMatchPartyTeamParty(party)).length;
  if (matchTeamCount >= 2) return "팀전";
  if (matchTeamCount > 0 || matchPartyCount > 0) return "팀 파티 포함";
  return "개인 매칭";
}

function getMatchSideCount(match, sideName) {
  return new Set([
    ...(match[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ].filter(Boolean)).size;
}

function getScore(match, sideName) {
  const side = getSafeMatchSide(match, sideName);
  return Number(side.score ?? match.result?.[sideName === "teamA" ? "scoreA" : "scoreB"] ?? 0);
}

function shouldShowScore(match) {
  const phase = getMatchRoomPhase(match).phase;
  return Boolean(match.result || match.endedAt || ["postgame", "dispute"].includes(phase));
}

function getActionLabel(match) {
  const phase = getMatchRoomPhase(match);
  return phase.actionLabel || "방 보기";
}

function getDeadlineLabel(match) {
  const phase = getMatchRoomPhase(match).phase;
  const recordWindow = getMatchRecordWindow(match);
  if (phase === "live") return "경기 중";
  if (phase === "postgame") return recordWindow?.statExpired ? "기록 마감" : "기록 입력";
  if (phase === "dispute") return recordWindow?.disputeExpired ? "이의 마감" : "결과 확인";
  return "처리 필요";
}

export default function Recorder({ app }) {
  const user = app.currentUser;
  const [searchParams, setSearchParams] = useSearchParams();
  const queryMatchId = searchParams.get("match") ?? "";
  const [selectedMatchId, setSelectedMatchId] = useState(queryMatchId);
  const [recorderLoading, setRecorderLoading] = useState(false);
  const [recorderLoadError, setRecorderLoadError] = useState("");
  const [recorderLoadAttempt, setRecorderLoadAttempt] = useState(0);
  const recorderLoadRef = useRef("");

  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const matches = useMemo(
    () =>
      app.state.matches
        .filter((match) => canAccessActiveMatch(match, user, app.state))
        .sort((a, b) => String(a.scheduledAt ?? a.createdAt ?? "").localeCompare(String(b.scheduledAt ?? b.createdAt ?? ""))),
    [app.state, user],
  );

  useEffect(() => {
    setSelectedMatchId(queryMatchId);
  }, [queryMatchId]);

  useEffect(() => {
    if (!app.remoteReady || !user.id || app.recorderMatchesLoaded) return;
    const loadRecorderMatches = app.actions.loadRecorderMatches;
    if (!loadRecorderMatches) return;
    if (recorderLoadRef.current === user.id) return;
    recorderLoadRef.current = user.id;
    setRecorderLoading(true);
    setRecorderLoadError("");
    Promise.resolve(loadRecorderMatches())
      .then((result) => {
        if (result === false) {
          recorderLoadRef.current = "";
          setRecorderLoadError("진행 경기 목록을 불러오지 못했습니다.");
        }
      })
      .catch(() => {
        recorderLoadRef.current = "";
        setRecorderLoadError("진행 경기 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        setRecorderLoading(false);
      });
  }, [app.actions.loadRecorderMatches, app.recorderMatchesLoaded, app.remoteReady, recorderLoadAttempt, user.id]);

  const retryRecorderLoad = () => {
    recorderLoadRef.current = "";
    setRecorderLoadError("");
    setRecorderLoadAttempt((attempt) => attempt + 1);
  };

  const openMatch = (matchId) => {
    if (!matchId) return;
    setSelectedMatchId(matchId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("match", matchId);
      return next;
    }, { replace: true });
  };

  const closeMatch = () => {
    setSelectedMatchId("");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("match");
      return next;
    }, { replace: true });
  };

  const recorderPending = !matches.length && !recorderLoadError && (!app.recorderMatchesLoaded || recorderLoading);

  return (
    <>
      <div className="page-stack recorder-page">
        <header className="page-header recorder-header">
          <div>
            <span className="eyebrow">PLAY</span>
            <h1>플레이</h1>
            <p>경기 시작부터 기록 확정 전까지 필요한 작업을 표시합니다.</p>
          </div>
        </header>

        {!matches.length ? (
          <Card className="recorder-empty">
            {recorderPending ? (
              <BasketballLoader overlay label="플레이 확인 중" />
            ) : recorderLoadError ? (
              <>
                <ShieldCheck size={34} />
                <strong>{recorderLoadError}</strong>
                <p>서버 연결을 확인한 뒤 다시 시도합니다.</p>
                <button type="button" className="button button-secondary button-md" onClick={retryRecorderLoad}>다시 시도</button>
              </>
            ) : (
              <>
                <ShieldCheck size={34} />
                <strong>플레이 중인 경기 없음</strong>
                <p>이의신청이 끝나 기록이 확정되면 나/팀 기록으로 이동합니다.</p>
              </>
            )}
            <Link to="/app/matches" className="button button-secondary button-md">일정 보기</Link>
          </Card>
        ) : (
          <section className="om-match-list recorder-card-list" aria-label="플레이 목록">
            <div className="om-list-head">
              <div>
                <span className="om-kicker">ACTIVE</span>
                <h2>내 플레이</h2>
              </div>
              <span>{matches.length}개</span>
            </div>

            {matches.map((match) => {
              const phase = getMatchRoomPhase(match);
              const status = statusMeta[match.status] ?? { label: phase.listLabel ?? phase.label ?? match.status, tone: phase.tone ?? "blue" };
              const recorderSides = getStatRecorderSides(match, user.id);
              const sourcePost = match.recruitingPostId ? app.state.recruitingPosts.find((post) => post.id === match.recruitingPostId) : null;
              const title = getRecorderCardTitle(match);
              const scoreA = getScore(match, "teamA");
              const scoreB = getScore(match, "teamB");
              const reserveCount = getMatchReservePlayerIds(match, "teamA").length + getMatchReservePlayerIds(match, "teamB").length;
              const meta = `참여 ${getMatchPlayerIds(match).length}명 · A ${getMatchSideCount(match, "teamA")} / B ${getMatchSideCount(match, "teamB")}${reserveCount ? ` · 후보 ${reserveCount}` : ""}`;
              const hasScore = shouldShowScore(match);
              const summaryValue = hasScore ? `${scoreA} : ${scoreB}` : "vs";

              return (
                <MatchListCard
                  key={match.id}
                  status={status}
                  mode={match.mode}
                  visibility={getRoomVisibilityLabel(match, sourcePost)}
                  roomType={getRoomTypeLabel(match)}
                  competition={getRoomCompetitionLabel(match)}
                  referee={getRoomRefereeLabel(match)}
                  title={title}
                  meta={(
                    <>
                      <CalendarDays size={15} />
                      {getRoomScheduleLabel(match)} · <CourtHoverCard court={courtByName[match.court]} courtName={match.court}>{match.court}</CourtHoverCard>
                    </>
                  )}
                  summary={(
                    <MatchListSummary
                      left={<TeamHoverCard team={teamById[match.teamA?.teamId]} as="span">{match.teamA?.name ?? "A"}</TeamHoverCard>}
                      center={summaryValue}
                      right={<TeamHoverCard team={teamById[match.teamB?.teamId]} as="span">{match.teamB?.name ?? "B"}</TeamHoverCard>}
                      meta={meta}
                      detail={`${getRoleText(match, user, recorderSides)} · ${getDeadlineLabel(match)}`}
                    />
                  )}
                  actionLabel={getActionLabel(match)}
                  onOpen={() => openMatch(match.id)}
                  onAction={() => openMatch(match.id)}
                />
              );
            })}
          </section>
        )}
      </div>

      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="recorder" onClose={closeMatch} />
    </>
  );
}
