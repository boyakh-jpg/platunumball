import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import PageFrame, { PageHeader } from "../components/common/PageFrame.jsx";
import MyNavigation from "../components/profile/MyNavigation.jsx";
import { assetUrl } from "../lib/assets.js";
import { getProfileIconAchievementState, PROFILE_ICON_GROUPS } from "../lib/profileIcons.js";

const GROUP_EYEBROWS = {
  default: "Basic",
  beginner: "Starter",
  position: "Position",
  "position-play": "Position Play",
  achievement: "Game & Community",
  rank: "Rank",
  special: "Special",
  career: "Career",
  records: "Verified Activity",
  leaders: "Connections & Service",
  modes: "Game Modes",
  community: "Operations & Community",
  tournaments: "Tournaments",
};

const PAGE_SIZE = 24;

function AchievementCard({ icon, metrics, unlockedIconKeys }) {
  const state = getProfileIconAchievementState(icon.id, metrics, unlockedIconKeys);
  const requirements = icon.achievement?.requirements ?? [];
  const percent = Math.round((state?.progress ?? 0) * 100);
  return (
    <article className={`profile-achievement-card ${state?.unlocked ? "unlocked" : "locked"}`}>
      <div className="profile-achievement-icon">
        <img src={assetUrl(icon.src)} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="profile-achievement-body">
        <div className="profile-achievement-title">
          <strong>{icon.name}</strong>
          <span>{state?.unlocked ? "해금" : "잠김"}</span>
        </div>
        <p>{icon.achievement?.condition}</p>
        {requirements.length ? (
          <>
            <div className="profile-achievement-progress" aria-label={`달성률 ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="profile-achievement-metrics">
              {requirements.map((item) => (
                <small key={item.metric}>{item.label} {Math.min(Number(metrics?.[item.metric] ?? 0), item.target)}/{item.target}</small>
              ))}
            </div>
          </>
        ) : <small className="profile-achievement-default">모든 선수 사용 가능</small>}
      </div>
    </article>
  );
}

export default function ProfileAchievements({ app }) {
  const [data, setData] = useState({ metrics: {}, unlockedIconKeys: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.resolve(app.actions.loadProfileIconAchievements?.())
      .then((result) => {
        if (!active) return;
        if (!result || result?.ok === false) {
          setError("업적을 불러오지 못했습니다.");
          return;
        }
        setData({
          metrics: result?.metrics ?? {},
          unlockedIconKeys: result?.unlockedIconKeys ?? [],
        });
      })
      .catch(() => {
        if (active) setError("업적을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [app.actions, loadAttempt]);

  const catalog = useMemo(() => PROFILE_ICON_GROUPS.flatMap((group) => group.icons.map((icon) => ({
    icon,
    groupId: group.id,
    unlocked: Boolean(getProfileIconAchievementState(icon.id, data.metrics, data.unlockedIconKeys)?.unlocked),
  }))), [data.metrics, data.unlockedIconKeys]);
  const unlockedCount = catalog.filter((item) => item.unlocked).length;
  const search = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = catalog.filter(({ icon, groupId, unlocked }) => (
    (!category || groupId === category)
    && (status === "all" || (status === "unlocked" ? unlocked : !unlocked))
    && (!search || `${icon.name} ${icon.achievement?.condition ?? ""}`.toLocaleLowerCase("ko-KR").includes(search))
  ));
  const visible = filtered.slice(0, visibleCount);

  function changeFilter(setter, value) {
    setter(value);
    setVisibleCount(PAGE_SIZE);
  }

  function resetFilters() {
    setQuery("");
    setCategory("");
    setStatus("all");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <PageFrame
      className="profile-achievements-page"
      hero={(
        <PageHeader
          title="아이콘 업적"
          actions={<Button as={Link} variant="secondary" to="/app/profile">프로필로</Button>}
        />
      )}
      navigation={<MyNavigation />}
    >

      <Card className="section-card profile-achievement-summary">
        <div>
          <strong>{loading || error ? "—" : unlockedCount}</strong>
          <span>/ {catalog.length} 해금</span>
        </div>
        <p>조건을 달성한 아이콘은 한 번 해금되면 기록이나 등급이 바뀌어도 유지됩니다.</p>
      </Card>

      {loading ? <Card className="section-card"><div className="ui-empty-state-compact">업적 정리 중</div></Card> : null}
      {error ? (
        <Card className="section-card">
          <div className="ui-empty-state">
            <strong>{error}</strong>
            <Button type="button" variant="secondary" size="sm" onClick={() => setLoadAttempt((current) => current + 1)}>다시 시도</Button>
          </div>
        </Card>
      ) : null}
      {!loading && !error ? (
        <Card className="section-card">
          <div className="form-grid profile-achievement-filters">
            <label>아이콘 검색
              <input type="search" placeholder="이름 또는 달성 조건" value={query} onChange={(event) => changeFilter(setQuery, event.target.value)} />
            </label>
            <label>분류
              <select value={category} onChange={(event) => changeFilter(setCategory, event.target.value)}>
                <option value="">전체 분류</option>
                {PROFILE_ICON_GROUPS.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <label>달성 상태
              <select value={status} onChange={(event) => changeFilter(setStatus, event.target.value)}>
                <option value="all">전체 상태</option>
                <option value="unlocked">해금한 아이콘</option>
                <option value="locked">아직 잠긴 아이콘</option>
              </select>
            </label>
          </div>
          <div className="ui-action-row profile-achievement-result-count">
            <span role="status">{filtered.length}개 중 {visible.length}개 표시</span>
            {query || category || status !== "all" ? <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>필터 초기화</Button> : null}
          </div>
        </Card>
      ) : null}
      {!loading && !error && !filtered.length ? (
        <Card className="section-card"><div className="ui-empty-state"><strong>조건에 맞는 아이콘이 없습니다.</strong><p>검색어를 줄이거나 필터를 초기화해 보세요.</p></div></Card>
      ) : null}
      {!loading && !error ? PROFILE_ICON_GROUPS.map((group) => {
        const icons = visible.filter((item) => item.groupId === group.id);
        if (!icons.length) return null;
        return (
        <section key={group.id} className="profile-achievement-group">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{GROUP_EYEBROWS[group.id]}</p>
              <h2>{group.name}</h2>
            </div>
            <small>{catalog.filter((item) => item.groupId === group.id && item.unlocked).length}/{group.icons.length} 해금</small>
          </div>
          <div className="profile-achievement-grid">
            {icons.map(({ icon }) => (
              <AchievementCard key={icon.id} icon={icon} metrics={data.metrics} unlockedIconKeys={data.unlockedIconKeys} />
            ))}
          </div>
        </section>
      ); }) : null}
      {!loading && !error && filtered.length > visible.length ? (
        <div className="ui-action-row">
          <Button type="button" variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>아이콘 더 보기 · {filtered.length - visible.length}개 남음</Button>
        </div>
      ) : null}
    </PageFrame>
  );
}
