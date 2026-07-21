import { useEffect, useMemo, useState } from "react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import SearchPicker from "../common/SearchPicker.jsx";
import {
  AFFILIATION_TYPE,
  canChangeAffiliation,
  formatAffiliationChangeDate,
  getAffiliationNormalizedKey,
  getAffiliationMemberCount,
  getNextAffiliationChangeDate,
  normalizeAffiliationName,
} from "../../lib/affiliations.js";

function getSaveErrorMessage(error = "") {
  const code = String(error || "");
  if (code.startsWith("affiliation_change_cooldown:")) {
    const nextDate = code.slice(code.indexOf(":") + 1);
    return `소속은 ${formatAffiliationChangeDate(nextDate)}부터 다시 변경할 수 있습니다.`;
  }
  if (code === "invalid_affiliation_name") return "소속명은 2~40자로 입력하세요.";
  if (code === "affiliation_not_found") return "선택한 소속을 찾을 수 없습니다. 다시 검색하세요.";
  return "소속을 저장하지 못했습니다.";
}

export default function AffiliationEditor({ user, affiliations = [], actions }) {
  const [query, setQuery] = useState(user.affiliationName ?? "");
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const currentName = user.affiliationName ?? "";
  const currentId = user.affiliationId ?? "";
  const nextChangeDate = getNextAffiliationChangeDate(user);
  const changeAllowed = canChangeAffiliation(user);
  const organizationItems = useMemo(
    () => affiliations
      .filter((item) => item.type === AFFILIATION_TYPE && (item.status ?? "active") === "active")
      .sort((a, b) => getAffiliationMemberCount(b) - getAffiliationMemberCount(a) || String(a.name).localeCompare(String(b.name), "ko")),
    [affiliations],
  );

  useEffect(() => {
    setQuery(currentName);
    setSelected(currentId ? organizationItems.find((item) => item.id === currentId) ?? null : null);
  }, [currentId, currentName, organizationItems]);

  const selectAffiliation = (item) => {
    setSelected(item);
    setQuery(item.name ?? "");
    setFeedback("");
  };
  const updateQuery = (value) => {
    setQuery(value);
    if (getAffiliationNormalizedKey(value) !== getAffiliationNormalizedKey(selected?.name)) setSelected(null);
    setFeedback("");
  };
  const save = async (event) => {
    event.preventDefault();
    if (pending || !changeAllowed) return;
    const name = normalizeAffiliationName(query);
    if (name && name.length < 2) {
      setFeedback("소속명은 2자 이상 입력하세요.");
      return;
    }
    setPending(true);
    const result = await actions.setProfileAffiliation({ affiliationId: selected?.id ?? "", name });
    setPending(false);
    if (!result || result.ok === false) {
      setFeedback(getSaveErrorMessage(result?.error));
      return;
    }
    setFeedback(name ? "소속을 저장했습니다." : "소속을 비웠습니다.");
  };

  return (
    <Card className="section-card profile-affiliation-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Affiliation</p>
          <h2>소속</h2>
        </div>
        <Badge tone={currentId ? "blue" : "neutral"}>{currentId ? `${user.affiliationMemberCount ?? 0}명` : "선택 사항"}</Badge>
      </div>
      <form className="form-stack affiliation-editor-form" onSubmit={save}>
        <label>
          소속 검색 또는 새 소속 입력
          <SearchPicker
            value={query}
            onChange={updateQuery}
            placeholder="예: 서울대학교, 마포고, 랭크볼"
            items={organizationItems}
            remoteSearchType="affiliation"
            minSearchLength={2}
            limit={8}
            remoteLimit={12}
            title="기존 소속"
            emptyText="같은 소속이 없습니다. 입력한 이름으로 새로 만들 수 있습니다."
            floating
            closeOnResultClick
            renderItem={(item) => (
              <button key={item.id} type="button" className="search-picker-result-row affiliation-search-result" onClick={() => selectAffiliation(item)}>
                <span><strong>{item.name}</strong><small>{getAffiliationMemberCount(item)}명</small></span>
                <b>선택</b>
              </button>
            )}
          />
        </label>
        <p className="affiliation-policy-note">
          소속 인증은 하지 않습니다. 같은 소속은 검색 결과에서 선택하세요. 소속 변경은 30일에 한 번 가능하며, 혐오·차별·정치적 혐오 표현은 신고할 수 있습니다. 정당명 자체는 제한하지 않으며 운영자가 이름을 수정하거나 같은 소속을 통합할 수 있습니다.
        </p>
        {!changeAllowed && nextChangeDate ? <small className="form-warning">다음 변경 가능일: {formatAffiliationChangeDate(nextChangeDate)}</small> : null}
        {feedback ? <small role="status" className={feedback.includes("못") || feedback.includes("이상") ? "form-warning" : "muted"}>{feedback}</small> : null}
        <div className="affiliation-editor-actions">
          <Button type="submit" disabled={pending || !changeAllowed}>{pending ? "저장 중" : "소속 저장"}</Button>
          {currentId ? (
            <Button type="button" variant="secondary" disabled={pending || !changeAllowed} onClick={() => { setSelected(null); setQuery(""); setFeedback("소속 저장을 누르면 소속이 비워집니다."); }}>
              소속 없음
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
