import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
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

  const unlockedSet = useMemo(() => new Set(data.unlockedIconKeys), [data.unlockedIconKeys]);
  const totalCount = PROFILE_ICON_GROUPS.reduce((sum, group) => sum + group.icons.length, 0);

  return (
    <div className="page-stack profile-achievements-page">
      <header className="page-header">
        <div>
          <h1>아이콘 업적</h1>
        </div>
        <Button as={Link} variant="secondary" to="/app/profile">프로필로</Button>
      </header>

      <Card className="section-card profile-achievement-summary">
        <div>
          <strong>{unlockedSet.size}</strong>
          <span>/ {totalCount} 해금</span>
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
      {!loading && !error ? PROFILE_ICON_GROUPS.map((group) => (
        <section key={group.id} className="profile-achievement-group">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">{GROUP_EYEBROWS[group.id]}</p>
              <h2>{group.name}</h2>
            </div>
            <small>{group.icons.filter((icon) => unlockedSet.has(icon.id)).length}/{group.icons.length}</small>
          </div>
          <div className="profile-achievement-grid">
            {group.icons.map((icon) => (
              <AchievementCard key={icon.id} icon={icon} metrics={data.metrics} unlockedIconKeys={data.unlockedIconKeys} />
            ))}
          </div>
        </section>
      )) : null}
    </div>
  );
}
