import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { PLAYER_POSITIONS } from "../lib/constants.js";
import { AGE_GROUPS, getAgeGroupByBirthYear, getAgeGroupLabel, getAgeGroupSeasonForDate, getAgeGroupSeasonLabel, inferRegionSelection, REGION_TREE } from "../lib/profileSetup.js";

const POSITION_OPTIONS = PLAYER_POSITIONS.filter((position) => ["PG", "SG", "SF", "PF", "C"].includes(position));

function normalizeHandle(value, fallbackName) {
  const raw = String(value || fallbackName || "").trim().replace(/^@/, "");
  const safe = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  return `@${safe || "rankball"}`;
}

export default function Signup({ app, auth }) {
  const navigate = useNavigate();
  const user = app.currentUser;
  const inferredRegion = inferRegionSelection(user.region);
  const [draft, setDraft] = useState({
    name: user.name ?? "",
    handle: user.handle ?? "",
    birthYear: user.birthYear ?? "",
    position: POSITION_OPTIONS.includes(user.position) ? user.position : "PG",
    sido: user.regionSido ?? inferredRegion.sido,
    district: user.regionDistrict ?? inferredRegion.district,
  });
  const selectedRegion = REGION_TREE.find((item) => item.sido === draft.sido) ?? REGION_TREE[0];
  const ageGroup = getAgeGroupByBirthYear(draft.birthYear) ?? user.ageGroup ?? "open";
  const ageGroupLabel = getAgeGroupLabel(ageGroup);
  const ageGroupSeason = getAgeGroupSeasonForDate();
  const ageGroupSeasonLabel = getAgeGroupSeasonLabel();
  const email = auth?.user?.email ?? auth?.user?.user_metadata?.email ?? "Google OAuth 또는 데모 계정";

  const districtOptions = useMemo(() => selectedRegion.districts, [selectedRegion]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    const name = draft.name.trim() || user.name;
    const handle = normalizeHandle(draft.handle, name);
    const district = districtOptions.includes(draft.district) ? draft.district : districtOptions[0];
    app.actions.updateProfile({
      name,
      handle,
      birthYear: Number(draft.birthYear) || null,
      ageGroup,
      ageGroupCheckedSeason: ageGroupSeason.id,
      position: draft.position,
      region: `${draft.sido} ${district}`,
      regionSido: draft.sido,
      regionDistrict: district,
      school: "",
      company: "",
      onboardingComplete: true,
      profileVersion: 1,
    });
    navigate("/app/profile");
  };

  return (
    <div className="page-stack signup-setup-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Signup</p>
          <h1>가입 정보 설정</h1>
        </div>
        <Link className="button button-secondary" to="/app/profile"><ArrowLeft size={17} /> 프로필로</Link>
      </header>

      <div className="content-grid signup-setup-grid">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Profile</p>
              <h2>기본 프로필</h2>
            </div>
            <Badge tone="green">{ageGroupLabel}</Badge>
          </div>

          <form className="form-grid" onSubmit={submit}>
            <label>
              닉네임
              <input required value={draft.name} maxLength={20} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label>
              해시태그
              <input value={draft.handle} maxLength={22} placeholder="@minjun" onChange={(event) => update({ handle: event.target.value })} />
            </label>
            <label>
              출생연도
              <input required value={draft.birthYear} inputMode="numeric" maxLength={4} minLength={4} placeholder="2008" onChange={(event) => update({ birthYear: event.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </label>
            <label>
              주 포지션
              <select value={draft.position} onChange={(event) => update({ position: event.target.value })}>
                {POSITION_OPTIONS.map((position) => <option key={position} value={position}>{position}</option>)}
              </select>
            </label>
            <label>
              시도
              <select value={draft.sido} onChange={(event) => update({ sido: event.target.value, district: REGION_TREE.find((item) => item.sido === event.target.value)?.districts[0] ?? "" })}>
                {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
              </select>
            </label>
            <label>
              시군구
              <select value={districtOptions.includes(draft.district) ? draft.district : districtOptions[0]} onChange={(event) => update({ district: event.target.value })}>
                {districtOptions.map((district) => <option key={district} value={district}>{district}</option>)}
              </select>
            </label>
            <div className="create-submit-row signup-submit-row">
              <span className="create-submit-warning">학교/회사는 가입 단계에서 받지 않음. 지역과 연령부만 매칭 기준으로 사용.</span>
              <Button type="submit"><CheckCircle2 size={18} /> 저장</Button>
            </div>
          </form>
        </Card>

        <aside className="page-stack">
          <Card className="section-card signup-preview-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Account</p>
                <h2>로그인 연결</h2>
              </div>
            </div>
            <div className="contract-grid single">
              <div>
                <span>계정</span>
                <strong>{email}</strong>
              </div>
              <div>
                <span>프로필</span>
                <strong>Google 계정당 1개</strong>
              </div>
            </div>
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Age Group</p>
                <h2>연령부</h2>
              </div>
            </div>
            <div className="age-group-grid">
              {AGE_GROUPS.map((group) => (
                <span key={group.id} className={group.id === ageGroup ? "active" : ""}>
                  <strong>{group.label}</strong>
                  <em>{group.rangeLabel}</em>
                </span>
              ))}
            </div>
          </Card>
          <Card className="section-card">
            <p className="muted">Google OAuth에서는 앱이 바로 쓸 수 있는 출생연도를 안정적으로 받지 않는다. 연령부는 출생연도 기준으로 자동 계산하고, {ageGroupSeasonLabel} 단위로 다시 확인한다. 나이 속임은 신고 사유로 처리한다.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
