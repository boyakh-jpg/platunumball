import { useCallback, useEffect, useRef, useState } from "react";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import NameReportForm from "../components/common/NameReportForm.jsx";
import { AFFILIATION_TYPES } from "../lib/constants.js";
import { AFFILIATION_TYPE, getAffiliationMemberCount } from "../lib/affiliations.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

export default function Affiliations({ app }) {
  const [reportTargetId, setReportTargetId] = useState("");
  const [directoryLoadState, setDirectoryLoadState] = useState("idle");
  const directoryLoadPendingRef = useRef(false);
  const loadDirectory = app.actions.loadDirectory;
  const visibleAffiliations = app.rankings.affiliations.filter((affiliation) => (
    ["region", AFFILIATION_TYPE].includes(affiliation.type)
    && (affiliation.status ?? "active") === "active"
  ));
  const typeRankById = new Map();
  ["region", AFFILIATION_TYPE].forEach((type) => {
    visibleAffiliations
      .filter((affiliation) => affiliation.type === type)
      .sort((a, b) => b.score - a.score)
      .forEach((affiliation, index) => typeRankById.set(affiliation.id, index + 1));
  });
  const rankedAffiliations = visibleAffiliations.map((affiliation) => ({
    ...affiliation,
    rank: typeRankById.get(affiliation.id) ?? 0,
  }));
  const userAffiliationIds = new Set([app.currentUser.affiliationId].filter(Boolean));
  const userAffiliationNames = new Set([app.currentUser.region].filter(Boolean));
  const myAffiliations = rankedAffiliations
    .filter((affiliation) => userAffiliationIds.has(affiliation.id) || userAffiliationNames.has(affiliation.name));
  const directoryLoading = directoryLoadState === "idle" || directoryLoadState === "loading";

  const refreshAffiliations = useCallback(async (force = false) => {
    if (!isSupabaseConfigured) {
      setDirectoryLoadState("loaded");
      return true;
    }
    if (directoryLoadPendingRef.current) return false;
    directoryLoadPendingRef.current = true;
    setDirectoryLoadState("loading");
    try {
      const result = await loadDirectory?.({ force, kind: "affiliations", limit: 100, offset: 0 });
      setDirectoryLoadState(result === true ? "loaded" : "error");
      return result === true;
    } catch {
      setDirectoryLoadState("error");
      return false;
    } finally {
      directoryLoadPendingRef.current = false;
    }
  }, [loadDirectory]);

  useEffect(() => {
    if (!app.remoteReady || directoryLoadState !== "idle") return;
    void refreshAffiliations();
  }, [app.remoteReady, directoryLoadState, refreshAffiliations]);
  const challengeRows = myAffiliations.map((affiliation) => {
    const sameType = rankedAffiliations
      .filter((item) => item.type === affiliation.type)
      .sort((a, b) => b.score - a.score);
    const typeRank = affiliation.rank;
    const target = typeRank > 1 ? sameType[typeRank - 2] : sameType[1];
    return {
      ...affiliation,
      typeRank,
      target,
      challengeType: typeRank > 1 ? "chase" : "defend",
      gap: target ? Math.abs(Math.round(target.score - affiliation.score)) : 0,
    };
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Affiliations</p>
          <h1>소속별 랭킹</h1>
        </div>
      </header>

      {directoryLoadState === "error" ? (
        <Card className="section-card">
          <p>소속 랭킹을 불러오지 못했습니다.</p>
          <Button type="button" variant="secondary" onClick={() => void refreshAffiliations(true)}>다시 시도</Button>
        </Card>
      ) : null}
      {directoryLoading ? <BasketballLoader label="소속 순위 불러오는 중" /> : null}

      {rankedAffiliations.length ? <><section className="affiliation-challenge-grid">
        <Card className="section-card affiliation-focus-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">My Affiliation</p>
              <h2>내 소속 비교</h2>
            </div>
            <Badge tone="blue">{myAffiliations.length}개</Badge>
          </div>
          <div className="affiliation-challenge-list">
            {challengeRows.map((affiliation) => (
              <div key={affiliation.id}>
                <span>{AFFILIATION_TYPES[affiliation.type]}</span>
                <strong>{affiliation.name}</strong>
                <em>{affiliation.typeRank}위 · {Math.round(affiliation.score)}점</em>
                <b>
                  {affiliation.target
                    ? affiliation.challengeType === "chase"
                      ? `${affiliation.target.name}까지 ${affiliation.gap}점`
                      : `${affiliation.target.name}보다 ${affiliation.gap}점 앞섬`
                    : "방어전"}
                </b>
              </div>
            ))}
          </div>
        </Card>
        <Card className="section-card affiliation-focus-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Challenge</p>
              <h2>다음 목표</h2>
            </div>
          </div>
          <div className="compact-list">
            {challengeRows.map((affiliation) => (
              <div key={`${affiliation.id}-target`}>
                <span>
                  {affiliation.target
                    ? affiliation.challengeType === "chase"
                      ? `${affiliation.name} → ${affiliation.target.name}`
                      : `${affiliation.name} 1위 방어`
                    : `${affiliation.name} 1위 유지`}
                </span>
                <strong>{affiliation.target ? `${affiliation.gap}점 차` : "TOP"}</strong>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="card-grid">
        {rankedAffiliations.map((affiliation) => (
          <Card key={affiliation.id} className="affiliation-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">#{affiliation.rank} {AFFILIATION_TYPES[affiliation.type]}</p>
                <h2>{affiliation.name}</h2>
              </div>
              <Badge tone="blue">{Math.round(affiliation.score)}</Badge>
            </div>
            <div className="stat-strip">
              <span><strong>{affiliation.wins}</strong>승</span>
              <span><strong>{affiliation.losses}</strong>패</span>
              <span><strong>{affiliation.type === AFFILIATION_TYPE ? getAffiliationMemberCount(affiliation) : Math.round((affiliation.wins / Math.max(1, affiliation.wins + affiliation.losses)) * 100)}</strong>{affiliation.type === AFFILIATION_TYPE ? "명" : "% 승률"}</span>
            </div>
            {affiliation.type === AFFILIATION_TYPE ? (
              <div className="affiliation-report-control">
                <Button type="button" size="sm" variant="secondary" onClick={() => setReportTargetId((current) => current === affiliation.id ? "" : affiliation.id)}>
                  소속명 신고
                </Button>
                {reportTargetId === affiliation.id ? (
                  <NameReportForm
                    label="소속명"
                    onCancel={() => setReportTargetId("")}
                    onSubmit={(reason) => app.actions.reportAffiliationName(affiliation.id, reason, affiliation.name)}
                  />
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
      </section></> : null}
      {directoryLoadState === "loaded" && !rankedAffiliations.length ? <div className="ui-empty-state-compact">표시할 소속 순위가 없습니다.</div> : null}
    </div>
  );
}
