import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CalendarClock, ListChecks, MapPin, RefreshCw } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import {
  cleanRoomTitle,
  getMatchListScope,
  getRoomScheduleLabel,
  isMatchListInitialLoading,
  MATCH_LIST_SCOPES,
  selectMatchListMatches,
} from "../lib/matchUtils.js";
import { getRoomRemakeNavigationState } from "../lib/matchCreationPolicies.js";
import { selectOperationsMatches } from "../lib/operationsCenter.js";

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "now", label: "지금" },
  { id: "upcoming", label: "다음" },
  { id: "past", label: "지난" },
];

const GROUPS = [
  { id: "now", label: "지금 처리", description: "출석, 진행, 결과 확인이 필요한 경기" },
  { id: "upcoming", label: "다음 경기", description: "확정과 준비 상태를 확인할 경기" },
  { id: "past", label: "지난 경기", description: "기록 또는 종료 상태를 확인할 경기" },
];

const ROLE_LABELS = {
  host: "주최자",
  referee: "심판",
};

const PHASE_DESCRIPTIONS = {
  waiting: "참가자와 경기 확정을 확인하세요.",
  locked: "확정된 참가자와 경기 준비를 확인하세요.",
  checkin: "출석과 라인업을 확인하세요.",
  live: "경기 시계와 점수를 기록하세요.",
  postgame: "경기 결과와 기록을 마무리하세요.",
  dispute: "이의 신청과 결과 확인을 처리하세요.",
  record: "확정된 경기 기록입니다.",
  cancelled: "취소된 경기입니다.",
  void: "무효 처리된 경기입니다.",
};

function getMatchTitle(match = {}) {
  const title = cleanRoomTitle(match.title, "");
  if (title) return title;
  const matchup = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return matchup || "경기";
}

function getMatchCourt(match = {}) {
  return String(match.court ?? "").trim() || "장소 미정";
}

function getSortValue(match = {}) {
  const value = match.scheduledAt ?? match.scheduledDate ?? match.createdAt ?? "";
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function sortOperationsItems(items = [], descending = false) {
  return [...items].sort((left, right) => {
    const delta = getSortValue(left.match) - getSortValue(right.match);
    return descending ? -delta : delta;
  });
}

function OperationsRow({ item, onOpen, onRepeat }) {
  const { match, phase, role, canRepeat } = item;
  const phaseLabel = phase.listLabel ?? phase.label ?? "상태 확인";
  const phaseDescription = PHASE_DESCRIPTIONS[phase.phase] ?? "경기 상태를 확인하세요.";

  return (
    <article className="operations-row">
      <div className="operations-row__main">
        <div className="operations-row__title">
          <h4>{getMatchTitle(match)}</h4>
          <Badge tone={phase.tone ?? "neutral"}>{phaseLabel}</Badge>
        </div>
        <p>{ROLE_LABELS[role]} · {phaseDescription}</p>
        <div className="operations-row__meta">
          <span><CalendarClock size={15} />{getRoomScheduleLabel(match)}</span>
          <span><MapPin size={15} />{getMatchCourt(match)}</span>
        </div>
      </div>
      <div className="ui-action-row ui-action-row-end operations-row__actions">
        {canRepeat ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onRepeat(item)}
          >
            다시 만들기
          </Button>
        ) : null}
        <Button type="button" onClick={() => onOpen(match.id)}>
          경기 열기
        </Button>
      </div>
    </article>
  );
}

export default function OperationsCenter({ app }) {
  const userId = app.currentUser?.id ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshRequestRef = useRef(null);
  const operationsMatchList = getMatchListScope(app.matchLists, MATCH_LIST_SCOPES.OPERATIONS);
  const loadOperationsMatches = app.actions.loadOperationsMatches;
  const scopedMatches = useMemo(
    () => selectMatchListMatches(app.matchEntities, app.matchLists, MATCH_LIST_SCOPES.OPERATIONS),
    [app.matchEntities, app.matchLists],
  );
  const scopedRecruitingPosts = useMemo(() => {
    const allowedIds = new Set(operationsMatchList.recruitingPostIds);
    return (app.state.recruitingPosts ?? []).filter((post) => allowedIds.has(post.id));
  }, [app.state.recruitingPosts, operationsMatchList.recruitingPostIds]);
  const groupedItems = useMemo(() => {
    const selected = selectOperationsMatches(scopedMatches, userId, {
      recruitingPosts: scopedRecruitingPosts,
      now: clockNow,
    });
    return {
      now: sortOperationsItems(selected.now),
      upcoming: sortOperationsItems(selected.upcoming),
      past: sortOperationsItems(selected.past, true),
    };
  }, [clockNow, scopedMatches, scopedRecruitingPosts, userId]);
  const totalCount = groupedItems.now.length + groupedItems.upcoming.length + groupedItems.past.length;

  const refresh = useCallback(async () => {
    if (!app.remoteReady || !userId || !loadOperationsMatches) return false;
    if (refreshRequestRef.current) return refreshRequestRef.current;
    const request = (async () => {
      setRefreshing(true);
      setRefreshError("");
      try {
        const result = await loadOperationsMatches({ force: true });
        if (result === false) {
          setRefreshError("운영 경기 목록을 불러오지 못했습니다.");
          return false;
        }
        setClockNow(new Date());
        return true;
      } catch {
        setRefreshError("운영 경기 목록을 불러오지 못했습니다.");
        return false;
      } finally {
        setRefreshing(false);
      }
    })();
    refreshRequestRef.current = request;
    try {
      return await request;
    } finally {
      refreshRequestRef.current = null;
    }
  }, [app.remoteReady, loadOperationsMatches, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const openMatch = (matchId) => {
    if (!matchId) return;
    navigate(`/app/matches?match=${encodeURIComponent(matchId)}`, {
      state: { matchModalReturnTo: `${location.pathname}${location.search}` },
    });
  };

  const repeatMatch = ({ match, sourcePost }) => {
    if (!sourcePost) return;
    navigate("/app/create", {
      state: getRoomRemakeNavigationState(sourcePost, match),
    });
  };

  const pending = !totalCount && (app.remoteReady === false || isMatchListInitialLoading(operationsMatchList));
  const loadError = !totalCount && (refreshError || operationsMatchList.error)
    ? "운영 경기 목록을 불러오지 못했습니다."
    : "";
  const visibleGroups = filter === "all"
    ? GROUPS.filter((group) => groupedItems[group.id].length)
    : GROUPS.filter((group) => group.id === filter);

  return (
    <div className="page-stack operations-page">
      <header className="page-header operations-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <h1>운영</h1>
          <p>내가 주최하거나 심판을 맡은 경기의 다음 할 일만 모았습니다.</p>
        </div>
      </header>

      {refreshError && totalCount ? (
        <div className="operations-refresh-status" role="status" aria-live="polite">
          <span>새 목록을 확인하지 못했습니다. 현재 목록을 그대로 표시합니다.</span>
        </div>
      ) : null}

      {pending ? (
        <BasketballLoader overlay label="운영 경기 확인 중" />
      ) : loadError ? (
        <EmptyState
          tone="error"
          title={loadError}
          description="서버 연결을 확인한 뒤 다시 시도합니다."
          action={<Button type="button" variant="secondary" onClick={() => void refresh()}>다시 시도</Button>}
        />
      ) : !totalCount ? (
        <EmptyState
          icon={ListChecks}
          title="운영할 경기 없음"
          action={<Button as={Link} to="/app/create">경기 만들기</Button>}
        />
      ) : (
        <Card className="section-card operations-inbox">
          <div className="section-title-row operations-inbox__head">
            <div>
              <h2>내 운영 업무</h2>
              <p>{totalCount}개 경기</p>
            </div>
            <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>
              <RefreshCw size={16} /> {refreshing ? "확인 중" : "새로고침"}
            </Button>
          </div>

          <div className="operations-filter-shell">
            <div className="ui-filter-row operations-filter" role="group" aria-label="운영 경기 필터">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={filter === item.id ? "primary" : "secondary"}
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {visibleGroups.map((group) => (
            <section key={group.id} className="operations-group" aria-labelledby={`operations-${group.id}`}>
              <div className="operations-group__head">
                <div>
                  <h3 id={`operations-${group.id}`}>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
              </div>
              {groupedItems[group.id].length ? (
                <div className="operations-list ui-design-borderless-list">
                  {groupedItems[group.id].map((item) => (
                    <OperationsRow key={item.match.id} item={item} onOpen={openMatch} onRepeat={repeatMatch} />
                  ))}
                </div>
              ) : (
                <EmptyState title={`${group.label} 없음`} description="다른 구간을 확인하세요." />
              )}
            </section>
          ))}
        </Card>
      )}
    </div>
  );
}
