import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { cloneRatingPolicy, DEFAULT_RATING_POLICY, getRatingPolicyValue, normalizeRatingPolicy, RATING_POLICY_GROUPS, setRatingPolicyValue } from "../lib/ratingPolicy.js";
import {
  formatDate,
} from "./adminPageModel.js";

export function DetailList({ title, empty, children }) {
  return (
    <div className="admin-detail-list">
      <strong>{title}</strong>
      <div>{children ?? <span className="admin-empty-line">{empty}</span>}</div>
    </div>
  );
}

export function RatingPolicyPanel({ app }) {
  const loadRatingPolicy = app.actions.loadRatingPolicy;
  const [draft, setDraft] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [savedPolicy, setSavedPolicy] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [defaultPolicy, setDefaultPolicy] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [policyGroups, setPolicyGroups] = useState(RATING_POLICY_GROUPS);
  const [version, setVersion] = useState(1);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");

  const applyResult = (result = {}) => {
    const groups = Array.isArray(result.schema) ? result.schema : RATING_POLICY_GROUPS;
    const defaultsSource = result.defaults ?? DEFAULT_RATING_POLICY;
    const policy = normalizeRatingPolicy(result.policy ?? defaultsSource, groups, defaultsSource);
    const defaults = normalizeRatingPolicy(defaultsSource, groups, defaultsSource);
    setPolicyGroups(groups);
    setDraft(policy);
    setSavedPolicy(policy);
    setDefaultPolicy(defaults);
    setVersion(Number(result.version ?? 1));
    setHistory(result.history ?? []);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRatingPolicy?.()
      .then((result) => {
        if (!active) return;
        if (!result || result.ok === false) {
          setStatus("정책을 불러오지 못했습니다.");
          return;
        }
        applyResult(result);
      })
      .catch(() => {
        if (active) setStatus("정책을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadRatingPolicy]);

  const changed = JSON.stringify(draft) !== JSON.stringify(savedPolicy);
  const updateField = (field, rawValue) => {
    const value = Math.max(field.min, Math.min(field.max, Number(rawValue)));
    setDraft((current) => setRatingPolicyValue(current, field.path, Number.isFinite(value) ? value : field.min));
    setStatus("");
  };
  const requestSave = () => {
    if (reason.trim().length < 4) {
      setStatus("변경 사유를 4자 이상 입력해 주세요.");
      return;
    }
    setConfirming(true);
  };
  const savePolicy = async () => {
    setConfirming(false);
    setSaving(true);
    setStatus("저장 중");
    try {
      const result = await app.actions.updateRatingPolicy?.({
        expectedVersion: version,
        policy: normalizeRatingPolicy(draft, policyGroups, defaultPolicy),
        reason: reason.trim(),
      });
      if (!result || result.ok === false) {
        setStatus(result?.error?.includes?.("stale") ? "다른 관리자가 먼저 저장했습니다. 최신 내용을 다시 불러와 주세요." : "정책을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      applyResult(result);
      setReason("");
      setStatus("저장되었습니다.");
    } catch {
      setStatus("정책을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="section-card admin-rating-policy">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Rating Policy</p>
          <h2>MMR·신뢰도 이벤트 정책</h2>
          <span>현재 버전 {version} · 변경은 저장 이후 확정되는 경기와 새 이벤트부터 적용됩니다.</span>
        </div>
        <Badge tone="orange">최고관리자</Badge>
      </div>

      {loading ? <div className="ui-empty-state-compact">정책 불러오는 중</div> : (
        <>
          <div className="admin-rating-groups">
            {policyGroups.map((group) => (
              <section key={group.id} className="admin-rating-group">
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <div className="admin-rating-field-grid">
                  {group.fields.map((field) => {
                    const id = `rating-${field.path.join("-")}`;
                    return (
                      <label key={id} htmlFor={id}>
                        <span>{field.label}</span>
                        <span className="admin-rating-input">
                          <input
                            id={id}
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={getRatingPolicyValue(draft, field.path)}
                            onChange={(event) => updateField(field, event.target.value)}
                          />
                          <em>{field.unit}</em>
                        </span>
                        <small>{field.min}~{field.max}{field.unit}</small>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="admin-rating-save">
            <label>
              변경 사유
              <input value={reason} maxLength={160} placeholder="예: 시즌 초 1v1 변동폭 완화" onChange={(event) => setReason(event.target.value)} />
            </label>
            <div>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => {
                setDraft(cloneRatingPolicy(defaultPolicy));
                setStatus("기본값을 초안에 적용했습니다.");
              }}>
                <RotateCcw size={16} /> 기본값
              </Button>
              <Button type="button" disabled={!changed || saving} onClick={requestSave}>
                <Save size={16} /> 저장
              </Button>
            </div>
            {status ? <strong className="admin-rating-status" aria-live="polite">{status}</strong> : null}
          </div>

          <div className="admin-rating-history">
            <strong>최근 변경</strong>
            {history.length ? history.map((entry) => (
              <div key={entry.id}>
                <span><b>v{entry.version}</b>{entry.reason || "사유 없음"}</span>
                <small>{entry.createdBy || "-"} · {formatDate(entry.createdAt)}</small>
              </div>
            )) : <span className="admin-empty-line">변경 이력 없음</span>}
          </div>
        </>
      )}
      </Card>
      {confirming ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="MMR·신뢰도 정책 저장" onMouseDown={(event) => event.stopPropagation()}>
            <strong>정책 버전 {version + 1}로 저장할까요?</strong>
            <p>저장 이후 확정되는 경기와 새 신뢰도 이벤트부터 적용됩니다. 이전 결과는 재계산하지 않습니다.</p>
            <div className="ui-action-row app-confirm-actions">
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>취소</Button>
              <Button type="button" onClick={savePolicy}>저장</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
