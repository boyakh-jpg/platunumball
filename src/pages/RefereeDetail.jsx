import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import RecentMatchRow from "../components/match/RecentMatchRow.jsx";
import EntityProfileHero from "../components/profile/EntityProfileHero.jsx";
import RefereeTierEmblem from "../components/rating/RefereeTierEmblem.jsx";
import { REFEREE_GRADE_META } from "../lib/admin.js";
import { assetUrl } from "../lib/assets.js";
import { getUserHashtag } from "../lib/handles.js";
import { compareMatchRecency, getMatchSideScore } from "../lib/matchUtils.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

const RECENT_REFEREE_MATCH_LIMIT = 12;

function isActiveAppointment(appointment = {}, userId = "") {
  const startsAt = appointment.startsAt ? new Date(appointment.startsAt).getTime() : 0;
  const endsAt = appointment.endsAt ? new Date(appointment.endsAt).getTime() : Number.POSITIVE_INFINITY;
  const now = Date.now();
  return (appointment.userId ?? appointment.user_id) === userId
    && (appointment.role ?? "referee") === "referee"
    && appointment.status === "active"
    && (!Number.isFinite(startsAt) || startsAt <= now)
    && (!Number.isFinite(endsAt) || now <= endsAt);
}

function formatActivityDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function getLocalDetail(app, refereeId) {
  const referee = app.state.users.find((user) => user.id === refereeId);
  const appointment = (app.state.settings?.refereeAppointments ?? []).find((row) => isActiveAppointment(row, refereeId));
  const grade = appointment?.grade;
  if (!referee || !appointment || !REFEREE_GRADE_META[grade]) return null;
  const matches = app.state.matches
    .filter((match) => match.refereeId === refereeId && match.status === "confirmed" && match.visibility !== "private")
    .sort(compareMatchRecency)
    .slice(0, RECENT_REFEREE_MATCH_LIMIT);
  return {
    referee: { ...referee, refereeGrade: grade, refereeProfile: { ...(referee.refereeProfile ?? {}), grade, status: "active" } },
    matches,
    teams: app.state.teams,
    stats: {
      completed: Number(referee.refereeProfile?.matchCount ?? matches.length),
      ranked: matches.filter((match) => match.ranked !== false).length,
      official: matches.filter((match) => match.official === true).length,
      recent: matches.length,
      lastMatchAt: matches[0]?.confirmedAt ?? matches[0]?.endedAt ?? null,
    },
  };
}

export default function RefereeDetail({ app }) {
  const { refereeId = "" } = useParams();
  const loadRefereeDetail = app.actions?.loadRefereeDetail;
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!refereeId || app.remoteReady === false) return undefined;
    let cancelled = false;
    if (!isSupabaseConfigured) {
      setDetail(getLocalDetail(app, refereeId));
      setStatus("loaded");
      return undefined;
    }
    if (!loadRefereeDetail) {
      setDetail(null);
      setStatus("error");
      return undefined;
    }
    setStatus("loading");
    Promise.resolve(loadRefereeDetail(refereeId, RECENT_REFEREE_MATCH_LIMIT))
      .then((result) => {
        if (cancelled) return;
        if (result?.ok === false && result.error !== "referee_not_found") {
          setDetail(null);
          setStatus("error");
          return;
        }
        setDetail(result?.referee ? {
          referee: result.referee,
          matches: result.state?.matches ?? [],
          teams: result.state?.teams ?? [],
          stats: result.stats ?? {},
        } : null);
        setStatus("loaded");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => { cancelled = true; };
  }, [app.remoteReady, app.state.matches, app.state.settings?.refereeAppointments, app.state.teams, app.state.users, loadRefereeDetail, refereeId]);

  const grade = detail?.referee?.refereeProfile?.grade ?? detail?.referee?.refereeGrade ?? "candidate";
  const gradeMeta = REFEREE_GRADE_META[grade] ?? REFEREE_GRADE_META.candidate;

  if (status === "loading") return <BasketballLoader label="심판 프로필을 불러오는 중" />;
  if (!detail?.referee) {
    return (
      <div className="page-stack rank-profile-page">
        <Card className="section-card ui-empty-state-compact">
          <span>{status === "error" ? "심판 프로필을 불러오지 못했습니다." : "활동 중인 심판 프로필이 없습니다."}</span>
          {status === "error" ? <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>다시 시도</Button> : null}
        </Card>
      </div>
    );
  }

  const { referee, matches, stats, teams } = detail;
  return (
    <div className="page-stack rank-profile-page profile-detail-page referee-detail-page">
      <EntityProfileHero
        className="profile-hero rank-profile-hero referee-profile-hero"
        style={{
          "--page-hero-bg": `url("${assetUrl("/assets/rankball-referee-profile-v4.webp")}")`,
          "--page-hero-bg-position": "center",
        }}
        eyebrow="Referee Profile"
        title={referee.name}
        subtitle={`${getUserHashtag(referee)} · ${referee.region ?? "지역 미설정"}`}
        badges={(
          <>
            <Badge tone={gradeMeta.tone} className="ui-liquid-glass">{gradeMeta.label}</Badge>
            <Badge tone="blue" className="ui-liquid-glass">신뢰도 {referee.trustScore ?? "-"}</Badge>
            <Badge tone="green" className="ui-liquid-glass">활동 중</Badge>
          </>
        )}
        visual={(
          <div className="player-tier-hero">
            <RefereeTierEmblem grade={grade} meta={gradeMeta} size="hero" showLabel />
          </div>
        )}
      />

      <div className="profile-page-navigation">
        <nav className="rank-profile-tabs">
          <a href="#referee-stats">통계</a>
          <a href="#referee-history">최근 경기</a>
        </nav>
        <Button as={Link} size="sm" variant="secondary" className="profile-role-link" to={`/app/players/${referee.id}`}>
          선수 프로필
          <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </div>

      <div className="referee-profile-body">
        <aside className="page-stack referee-profile-rail">
          <Card className="section-card referee-license-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">License</p>
                <h2>심판 자격</h2>
              </div>
              <ShieldCheck size={22} aria-hidden="true" />
            </div>
            <div className="referee-license-summary">
              <RefereeTierEmblem grade={grade} meta={gradeMeta} size="sm" />
              <span><b>{gradeMeta.label}</b><em>{gradeMeta.requirement}</em></span>
            </div>
            <dl className="referee-profile-facts">
              <div><dt>활동 상태</dt><dd>활동 중</dd></div>
              <div><dt>신뢰도</dt><dd>{referee.trustScore ?? "-"}</dd></div>
              <div><dt>최근 활동</dt><dd>{formatActivityDate(stats.lastMatchAt)}</dd></div>
            </dl>
          </Card>
        </aside>

        <div className="page-stack referee-profile-main">
          <Card id="referee-stats" className="section-card rank-record-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Referee Stats</p>
                <h2>심판 활동 통계</h2>
              </div>
              <Badge tone="green">확정 {stats.completed ?? 0}경기</Badge>
            </div>
            <div className="rank-stat-grid">
              <span><strong>{gradeMeta.code}</strong>현재 등급</span>
              <span><strong>{stats.completed ?? 0}</strong>확정 경기</span>
              <span><strong>{stats.ranked ?? 0}</strong>경쟁전</span>
              <span><strong>{stats.official ?? 0}</strong>공식 경기</span>
              <span><strong>{stats.recent ?? matches.length}</strong>최근 경기</span>
              <span><strong>{formatActivityDate(stats.lastMatchAt)}</strong>최근 활동</span>
            </div>
          </Card>

          <Card id="referee-history" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recent Officiating</p>
                <h2>최근 심판 경기</h2>
              </div>
              <Badge tone="blue">{matches.length}경기</Badge>
            </div>
            <div className="recent-match-list">
              {matches.map((match) => (
                <RecentMatchRow
                  key={match.id}
                  record={match}
                  result="neutral"
                  side={match.teamA}
                  opponent={match.teamB}
                  score={getMatchSideScore(match, "teamA")}
                  opponentScore={getMatchSideScore(match, "teamB")}
                  teams={teams}
                  to={`/app/matches?match=${match.id}`}
                  detail={match.official ? "공식 경기 심판" : match.ranked !== false ? "경쟁전 심판" : "친선전 심판"}
                />
              ))}
              {!matches.length ? <div className="ui-empty-state-compact">공개된 확정 심판 경기가 아직 없습니다.</div> : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
