import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { PLAYER_POSITIONS } from "../lib/constants.js";
import { getUserHashtag, sameHashtag, toHashtag } from "../lib/handles.js";
import {
  AGE_GROUPS,
  canChangeProfileName,
  getAgeGroupByBirthYear,
  getAgeGroupLabel,
  getAgeGroupSeasonForDate,
  getAgeGroupSeasonLabel,
  getNextNameChangeDate,
  inferRegionSelection,
  REGION_TREE,
} from "../lib/profileSetup.js";

const POSITION_OPTIONS = PLAYER_POSITIONS.filter((position) => ["PG", "SG", "SF", "PF", "C"].includes(position));

function formatDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export default function Signup({ app, auth }) {
  const navigate = useNavigate();
  const user = app.currentUser;
  const inferredRegion = inferRegionSelection(user.region);
  const [draft, setDraft] = useState({
    name: user.name ?? "",
    handle: getUserHashtag(user),
    birthYear: user.birthYear ?? "",
    position: POSITION_OPTIONS.includes(user.position) ? user.position : "PG",
    sido: user.regionSido ?? inferredRegion.sido,
    district: user.regionDistrict ?? inferredRegion.district,
  });
  const [formError, setFormError] = useState("");
  const selectedRegion = REGION_TREE.find((item) => item.sido === draft.sido) ?? REGION_TREE[0];
  const ageGroup = getAgeGroupByBirthYear(draft.birthYear) ?? user.ageGroup ?? "open";
  const ageGroupLabel = getAgeGroupLabel(ageGroup);
  const ageGroupSeason = getAgeGroupSeasonForDate();
  const ageGroupSeasonLabel = getAgeGroupSeasonLabel();
  const email = auth?.user?.email ?? auth?.user?.user_metadata?.email ?? "Google OAuth 또는 데모 계정";
  const handleLocked = Boolean(user.handleLockedAt || user.hashtagLockedAt);
  const birthYearLocked = Boolean(user.birthYearLockedAt);
  const nameChangeAllowed = canChangeProfileName(user);
  const nextNameChangeDate = getNextNameChangeDate(user);
  const normalizedHandle = handleLocked ? getUserHashtag(user) : toHashtag(draft.handle, draft.name || user.id);
  const handleDuplicate = !handleLocked && app.state.users.some((item) => item.id !== user.id && sameHashtag(normalizedHandle, getUserHashtag(item)));

  const districtOptions = useMemo(() => selectedRegion.districts, [selectedRegion]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    const name = draft.name.trim() || user.name;
    if (user.onboardingComplete && name !== user.name && !nameChangeAllowed) {
      setFormError(`닉네임은 월 1회만 변경할 수 있습니다. 다음 변경 가능일: ${formatDate(nextNameChangeDate)}`);
      return;
    }
    if (handleDuplicate) {
      setFormError("이미 사용 중인 해시태그입니다.");
      return;
    }
    const birthYear = birthYearLocked ? Number(user.birthYear) : Number(draft.birthYear);
    if (!birthYear || !getAgeGroupByBirthYear(birthYear)) {
      setFormError("출생연도를 정확히 입력하세요.");
      return;
    }
    const district = districtOptions.includes(draft.district) ? draft.district : districtOptions[0];
    const now = new Date().toISOString();
    try {
      await app.actions.updateProfile({
        name,
        ...(handleLocked ? {} : { handle: normalizedHandle, hashtag: normalizedHandle, handleLockedAt: now }),
        ...(birthYearLocked ? {} : { birthYear, birthYearLockedAt: now }),
        ageGroup: getAgeGroupByBirthYear(birthYear) ?? ageGroup,
        ageGroupCheckedSeason: ageGroupSeason.id,
        position: draft.position,
        region: `${draft.sido} ${district}`,
        regionSido: draft.sido,
        regionDistrict: district,
        school: "",
        company: "",
        onboardingComplete: true,
        profileVersion: 1,
        ...(name !== user.name ? { nameUpdatedAt: now } : {}),
      });
      navigate("/app/profile");
    } catch (error) {
      setFormError(error.message || "프로필 저장에 실패했습니다.");
    }
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
              {user.onboardingComplete && !nameChangeAllowed ? <span className="form-warning">다음 변경 가능일: {formatDate(nextNameChangeDate)}</span> : null}
            </label>
            <label>
              해시태그
              <input value={handleLocked ? getUserHashtag(user) : draft.handle} maxLength={22} placeholder="#minjun" disabled={handleLocked} onChange={(event) => update({ handle: event.target.value })} />
              {handleDuplicate ? <span className="form-warning">이미 사용 중인 해시태그입니다.</span> : null}
              {handleLocked ? <span className="muted">해시태그는 최초 등록 후 수정할 수 없습니다.</span> : null}
            </label>
            <label>
              출생연도
              <input required value={birthYearLocked ? user.birthYear : draft.birthYear} inputMode="numeric" maxLength={4} minLength={4} placeholder="2008" disabled={birthYearLocked} onChange={(event) => update({ birthYear: event.target.value.replace(/\D/g, "").slice(0, 4) })} />
              {birthYearLocked ? <span className="muted">출생연도는 최초 등록 후 수정할 수 없습니다.</span> : null}
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
            {formError ? <p className="form-warning">{formError}</p> : null}
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
