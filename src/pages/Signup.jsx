import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import ProfileBasicsFields from "../components/profile/ProfileBasicsFields.jsx";
import { BASKETBALL_POSITIONS } from "../lib/constants.js";
import { getUserHashtag, hasReservedOperatorIdentity, makeRandomDigitSuffix, makeSuggestedHashtagBody, PROFILE_HASHTAG_MIN_LENGTH, sameHashtag, stripHandle, toHashtag } from "../lib/handles.js";
import {
  getAccountRecoveryLoginPath,
  getAuthProviderLabel,
  getAuthProviderProfileName,
  getSingleRecoverableProviderId,
} from "../lib/authProviders.js";
import {
  AGE_GROUPS,
  canChangeProfileName,
  formatProfileDate,
  getAgeGroupByBirthYear,
  getAgeGroupLabel,
  getAgeGroupSeasonForDate,
  getAgeGroupSeasonLabel,
  getAppRedirectFromLocation,
  getNextNameChangeDate,
  inferRegionSelection,
  getRegionDistrictOptions,
  normalizeProfileName,
  PROFILE_NAME_MAX_LENGTH,
  shouldRecheckAgeGroup,
  shouldSetupProfile,
} from "../lib/profileSetup.js";

function getSuggestedHandleBody(name, suffix, users = [], currentUserId = "") {
  const base = makeSuggestedHashtagBody(name);
  const baseTaken = users.some((item) => item.id !== currentUserId && sameHashtag(base, getUserHashtag(item)));
  return baseTaken ? makeSuggestedHashtagBody(name, suffix) : base;
}

function getInitialHandleBody(user = {}, suffix = "", users = []) {
  if (user.handleLockedAt || user.hashtagLockedAt) return stripHandle(getUserHashtag(user));
  return stripHandle(user.hashtag ?? user.handle ?? "") || getSuggestedHandleBody(user.name, suffix, users, user.id);
}

export default function Signup({ app, auth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = app.currentUser;
  const providerProfileName = !user.onboardingComplete ? getAuthProviderProfileName(auth?.user) : "";
  const recoverableProviderId = !user.onboardingComplete ? getSingleRecoverableProviderId(auth?.user) : "";
  const redirectTo = getAppRedirectFromLocation(location, "/app/profile");
  const inferredRegion = inferRegionSelection([user.regionSido, user.regionDistrict, user.region].filter(Boolean).join(" "));
  const [suggestionSuffix] = useState(makeRandomDigitSuffix);
  const [handleTouched, setHandleTouched] = useState(() => Boolean(stripHandle(user.hashtag ?? user.handle ?? "")));
  const [draft, setDraft] = useState(() => ({
    name: providerProfileName || user.name || "",
    handle: getInitialHandleBody(user, suggestionSuffix, app.state.users),
    birthYear: user.birthYear ?? "",
    position: BASKETBALL_POSITIONS.includes(user.position) ? user.position : "PG",
    sido: user.regionSido ?? inferredRegion.sido,
    district: user.regionDistrict ?? inferredRegion.district,
  }));
  const [formError, setFormError] = useState("");
  const [profileSavePending, setProfileSavePending] = useState(false);
  const profileSavePendingRef = useRef(false);
  const [redirectAfterSave, setRedirectAfterSave] = useState(false);
  const [accountRecoveryOpen, setAccountRecoveryOpen] = useState(false);
  const [accountRecoveryPending, setAccountRecoveryPending] = useState(false);
  const [accountRecoveryError, setAccountRecoveryError] = useState("");
  const providerNameAppliedRef = useRef(false);
  const ageGroup = getAgeGroupByBirthYear(draft.birthYear) ?? user.ageGroup ?? "open";
  const ageGroupLabel = getAgeGroupLabel(ageGroup);
  const ageGroupSeason = getAgeGroupSeasonForDate();
  const ageGroupSeasonLabel = getAgeGroupSeasonLabel();
  const email = auth?.user?.email ?? auth?.user?.user_metadata?.email ?? "연결된 로그인 계정";
  const handleLocked = Boolean(user.handleLockedAt || user.hashtagLockedAt);
  const birthYearLocked = Boolean(user.birthYearLockedAt && user.birthYear);
  const nameChangeAllowed = canChangeProfileName(user);
  const nextNameChangeDate = getNextNameChangeDate(user);
  const handleBody = handleLocked ? stripHandle(getUserHashtag(user)) : stripHandle(draft.handle);
  const normalizedHandle = handleBody ? toHashtag(handleBody) : "";
  const handleDuplicate = !handleLocked && Boolean(normalizedHandle) && app.state.users.some((item) => item.id !== user.id && sameHashtag(normalizedHandle, getUserHashtag(item)));
  const setupRequired = shouldSetupProfile(user) || shouldRecheckAgeGroup(user);

  const districtOptions = getRegionDistrictOptions(draft.sido);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (providerNameAppliedRef.current || user.onboardingComplete || !providerProfileName) return;
    providerNameAppliedRef.current = true;
    setDraft((current) => current.name.trim() ? current : { ...current, name: providerProfileName });
  }, [providerProfileName, user.onboardingComplete]);

  useEffect(() => {
    if (handleLocked || handleTouched) return;
    const nextHandle = getSuggestedHandleBody(draft.name || user.name, suggestionSuffix, app.state.users, user.id);
    setDraft((current) => (current.handle === nextHandle ? current : { ...current, handle: nextHandle }));
  }, [app.state.users, draft.name, handleLocked, handleTouched, suggestionSuffix, user.id, user.name]);

  useEffect(() => {
    if (!redirectAfterSave) return;
    if (shouldSetupProfile(user) || shouldRecheckAgeGroup(user)) return;
    navigate(redirectTo, { replace: true });
  }, [navigate, redirectAfterSave, redirectTo, user]);

  const releaseCurrentLoginForRecovery = async () => {
    if (!recoverableProviderId || accountRecoveryPending) return;
    const confirmed = window.confirm("현재 로그인으로 만든 미완성 가입을 지우고 기존 BOXTIER 아이디로 다시 로그인합니다. 계속할까요?");
    if (!confirmed) return;
    setAccountRecoveryPending(true);
    setAccountRecoveryError("");
    try {
      const result = await auth.releaseOnboardingIdentity("기존 아이디 연결");
      if (!result?.ok) {
        setAccountRecoveryError(result?.message || "기존 아이디 연결을 시작하지 못했습니다.");
        return;
      }
      const releasedProvider = result.releasedProvider || recoverableProviderId;
      window.location.assign(getAccountRecoveryLoginPath(releasedProvider));
    } catch {
      setAccountRecoveryError("기존 아이디 연결을 시작하지 못했습니다.");
    } finally {
      setAccountRecoveryPending(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (profileSavePendingRef.current) return;
    const name = normalizeProfileName(draft.name);
    if (!name) {
      setFormError("닉네임을 입력해 주세요.");
      return;
    }
    if (name !== user.name && hasReservedOperatorIdentity({ name })) {
      setFormError("boxtier와 박스티어는 운영자 전용입니다.");
      return;
    }
    if (user.onboardingComplete && name !== user.name && !nameChangeAllowed) {
      setFormError(`닉네임은 월 1회만 변경할 수 있습니다. 다음 변경 가능일: ${formatProfileDate(nextNameChangeDate)}`);
      return;
    }
    if (handleDuplicate) {
      setFormError("이미 사용 중인 해시태그입니다.");
      return;
    }
    if (!handleLocked && !handleBody) {
      setFormError("해시태그를 직접 입력해 주세요.");
      return;
    }
    if (!handleLocked && hasReservedOperatorIdentity({ hashtag: normalizedHandle })) {
      setFormError("boxtier와 박스티어는 운영자 전용입니다.");
      return;
    }
    if (!handleLocked && handleBody.length < PROFILE_HASHTAG_MIN_LENGTH) {
      setFormError(`해시태그는 ${PROFILE_HASHTAG_MIN_LENGTH}글자 이상 입력해 주세요.`);
      return;
    }
    const birthYear = birthYearLocked ? Number(user.birthYear) : Number(draft.birthYear);
    if (!birthYear || !getAgeGroupByBirthYear(birthYear)) {
      setFormError("출생연도를 정확히 입력해 주세요.");
      return;
    }
    const district = districtOptions.includes(draft.district) ? draft.district : districtOptions[0];
    const now = new Date().toISOString();
    profileSavePendingRef.current = true;
    setProfileSavePending(true);
    setFormError("");
    try {
      const result = await app.actions.updateProfile({
        name,
        ...(handleLocked ? {} : { handle: normalizedHandle, hashtag: normalizedHandle, handleLockedAt: now }),
        ...(birthYearLocked ? {} : { birthYear, birthYearLockedAt: now }),
        ageGroup: getAgeGroupByBirthYear(birthYear) ?? ageGroup,
        ageGroupCheckedSeason: ageGroupSeason.id,
        position: draft.position,
        region: `${draft.sido} ${district}`,
        regionSido: draft.sido,
        regionDistrict: district,
        onboardingComplete: true,
        profileVersion: 1,
        ...(name !== user.name ? { nameUpdatedAt: now } : {}),
      });
      if (!result || result.ok === false) {
        setFormError(result?.error === "account_rejoin_blocked"
          ? "탈퇴한 로그인 계정은 탈퇴일로부터 7일 동안 다시 가입할 수 없습니다."
          : result?.error === "reserved_operator_identity"
            ? "boxtier와 박스티어는 운영자 전용입니다."
            : result?.error === "profile_identity_blocked"
              ? "사용할 수 없는 닉네임 또는 해시태그입니다."
            : "프로필을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
        return;
      }
      setRedirectAfterSave(true);
    } catch (error) {
      setFormError(error?.message === "account_rejoin_blocked"
        ? "탈퇴한 로그인 계정은 탈퇴일로부터 7일 동안 다시 가입할 수 없습니다."
        : error?.message === "reserved_operator_identity"
          ? "boxtier와 박스티어는 운영자 전용입니다."
          : error?.message === "profile_identity_blocked"
            ? "사용할 수 없는 닉네임 또는 해시태그입니다."
            : "프로필을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      profileSavePendingRef.current = false;
      setProfileSavePending(false);
    }
  };

  return (
    <div className="page-stack signup-setup-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">Signup</p>
          <h1>가입 정보 설정</h1>
        </div>
        {!setupRequired ? <Button as={Link} variant="secondary" to={redirectTo}><ArrowLeft size={17} /> 프로필로</Button> : null}
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

          <form className="form-grid profile-form-grid" onSubmit={submit}>
            <label>
              닉네임
              <input required value={draft.name} maxLength={PROFILE_NAME_MAX_LENGTH} onChange={(event) => update({ name: event.target.value })} />
              {providerProfileName && !user.onboardingComplete ? <span className="muted">로그인 프로필 이름을 불러왔습니다. 자유롭게 수정할 수 있습니다.</span> : null}
              {user.onboardingComplete && !nameChangeAllowed ? <span className="form-warning">다음 변경 가능일: {formatProfileDate(nextNameChangeDate)}</span> : null}
            </label>
            <label>
              해시태그
              <span className="prefixed-input">
                <span>#</span>
                <input value={handleBody} minLength={PROFILE_HASHTAG_MIN_LENGTH} maxLength={20} disabled={handleLocked} onChange={(event) => {
                  setHandleTouched(true);
                  update({ handle: stripHandle(event.target.value) });
                }} />
              </span>
              {handleDuplicate ? <span className="form-warning">이미 사용 중인 해시태그입니다.</span> : null}
              {!handleLocked && handleBody && handleBody.length < PROFILE_HASHTAG_MIN_LENGTH ? <span className="form-warning">해시태그는 {PROFILE_HASHTAG_MIN_LENGTH}글자 이상이어야 합니다.</span> : null}
              {handleLocked ? <span className="muted">해시태그는 최초 등록 후 수정할 수 없습니다.</span> : null}
            </label>
            <label>
              출생연도
              <input required value={birthYearLocked ? user.birthYear : draft.birthYear} inputMode="numeric" maxLength={4} minLength={4} placeholder="2008" disabled={birthYearLocked} onChange={(event) => update({ birthYear: event.target.value.replace(/\D/g, "").slice(0, 4) })} />
              {birthYearLocked ? <span className="muted">출생연도는 최초 등록 후 수정할 수 없습니다.</span> : null}
            </label>
            <ProfileBasicsFields
              position={draft.position}
              regionSido={draft.sido}
              regionDistrict={draft.district}
              onPositionChange={(position) => update({ position })}
              onRegionChange={(sido, district) => update({ sido, district })}
            />
            {formError ? <p className="form-warning">{formError}</p> : null}
            <div className="create-submit-row signup-submit-row">
              <span className="create-submit-warning">소속은 가입 후 나 메뉴에서 선택할 수 있습니다. 가입 단계에서는 지역과 연령부만 설정합니다.</span>
              <Button type="submit" disabled={profileSavePending || accountRecoveryPending}><CheckCircle2 size={18} /> {profileSavePending ? "저장 중" : "저장"}</Button>
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
                <strong>외부 로그인 계정 연결</strong>
              </div>
            </div>
            {recoverableProviderId ? (
              <div className="signup-account-recovery">
                <Button type="button" variant="secondary" onClick={() => setAccountRecoveryOpen((current) => !current)}>
                  이미 BOXTIER 아이디가 있어요
                </Button>
                {accountRecoveryOpen ? (
                  <div className="signup-account-recovery-panel">
                    <strong>기존 아이디 연결</strong>
                    <p>현재 {getAuthProviderLabel(recoverableProviderId)} 로그인으로 만든 미완성 가입만 지운 뒤, 기존 BOXTIER 아이디의 다른 로그인으로 다시 로그인합니다.</p>
                    <p>프로필·기록·MMR·팀 데이터는 자동으로 합치지 않습니다.</p>
                    <Button type="button" variant="secondary" onClick={() => void releaseCurrentLoginForRecovery()} disabled={accountRecoveryPending}>
                      {accountRecoveryPending ? "처리 중" : "기존 아이디로 다시 로그인"}
                    </Button>
                  </div>
                ) : null}
                {accountRecoveryError ? <p className="form-status form-status-error" role="alert">{accountRecoveryError}</p> : null}
              </div>
            ) : null}
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
            <p className="muted">외부 로그인에서는 출생연도를 자동으로 확인할 수 없습니다. 연령부는 입력한 출생연도를 기준으로 계산하며, {ageGroupSeasonLabel}마다 다시 확인합니다. 허위 출생연도 입력은 신고 사유로 처리됩니다.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
