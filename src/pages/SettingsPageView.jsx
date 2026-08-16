import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRightLeft, LogOut, Trash2 } from "lucide-react";
import AuthProviderIcon from "../components/auth/AuthProviderIcon.jsx";
import Button from "../components/common/Button.jsx";
import ModalShell from "../components/common/ModalShell.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { getAuthProviderLabel } from "../lib/authProviders.js";
import SettingsPrimaryColumn from "./SettingsPrimaryColumn.jsx";
import SettingsSideColumn from "./SettingsSideColumn.jsx";
import SettingsRefereeSection from "./SettingsRefereeSection.jsx";
import SettingsActivityDialog from "./SettingsActivityDialog.jsx";
import SettingsListDialog from "./SettingsListDialog.jsx";

export default function SettingsPageView({ controller, auth }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { sectionMeta, settingsSection, selectedReportCourtRequest } = controller;
  const canSwitchTestAccount = controller.serverAdminLevel >= 100 || Boolean(controller.currentTestLoginId);
  const [activityDetail, setActivityDetail] = useState(null);
  const [activityList, setActivityList] = useState("");
  const [testLoginId, setTestLoginId] = useState(() => controller.currentTestLoginId || auth?.testAccounts?.[0]?.id || "");
  const [testSwitchStatus, setTestSwitchStatus] = useState("");
  const [identityStatus, setIdentityStatus] = useState("");
  const [identityStatusTone, setIdentityStatusTone] = useState("");
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [withdrawalAcknowledged, setWithdrawalAcknowledged] = useState(false);
  const [withdrawalStatus, setWithdrawalStatus] = useState("");
  const linkedProviderIds = auth?.linkedProviderIds ?? [];
  const enabledProviders = auth?.enabledProviders ?? [];
  const requestedProviderId = new URLSearchParams(location.search).get("connectProvider") ?? "";
  const validRequestedProviderId = enabledProviders.some((provider) => provider.id === requestedProviderId)
    ? requestedProviderId
    : "";
  const requestedProviderLinked = Boolean(validRequestedProviderId && linkedProviderIds.includes(validRequestedProviderId));
  const connectableProviders = enabledProviders
    .filter((provider) => !linkedProviderIds.includes(provider.id))
    .sort((left, right) => Number(right.id === validRequestedProviderId) - Number(left.id === validRequestedProviderId));
  useBodyScrollLock(withdrawalOpen || Boolean(activityList) || Boolean(activityDetail));

  useEffect(() => {
    if (!requestedProviderLinked) return;
    setIdentityStatus(`${getAuthProviderLabel(validRequestedProviderId)} 로그인을 같은 프로필에 연결했습니다.`);
    setIdentityStatusTone("success");
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("connectProvider");
    const nextSearch = nextParams.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true });
  }, [location.pathname, location.search, navigate, requestedProviderLinked, validRequestedProviderId]);

  const switchTestAccount = async (event) => {
    event.preventDefault();
    setTestSwitchStatus("");
    const nextSession = await auth.switchTestAccount(testLoginId);
    if (!nextSession) {
      setTestSwitchStatus("계정을 전환하지 못했습니다.");
      return;
    }
    window.location.assign("/app/settings");
  };

  const withdrawAccount = async () => {
    setWithdrawalStatus("");
    const result = await auth.withdrawAccount(withdrawalAcknowledged ? "탈퇴" : "");
    if (result?.ok) {
      window.location.assign("/login?withdrawn=1");
      return;
    }
    setWithdrawalStatus(result?.error === "account_withdrawal_team_captain"
      ? "팀장인 팀을 먼저 위임하거나 삭제해 주세요."
      : "탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  };

  const linkIdentity = async (providerId) => {
    setIdentityStatus("");
    setIdentityStatusTone("");
    const returnTo = providerId === validRequestedProviderId
      ? `/app/settings?section=main&connectProvider=${encodeURIComponent(providerId)}`
      : "/app/settings?section=main";
    const result = await auth.linkIdentityWithProvider(providerId, returnTo);
    if (!result?.ok && result?.error !== "auth_action_pending") {
      setIdentityStatus(result?.message || "로그인 연결을 시작하지 못했습니다.");
      setIdentityStatusTone("error");
    }
  };

  return (
<div className={`page-stack settings-page settings-section-${settingsSection}${selectedReportCourtRequest ? " settings-report-open" : ""}`}>
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">{sectionMeta.eyebrow}</p>
          <h1>{sectionMeta.title}</h1>
        </div>
        {settingsSection !== "main" ? (
          <Button as={Link} variant="secondary" to="/app/settings">설정</Button>
        ) : null}
      </header>
      <div className={`content-grid ${settingsSection === "main" ? "" : "settings-section-grid"}`}>
        <SettingsPrimaryColumn controller={controller} />

        <SettingsSideColumn controller={controller} onOpenList={setActivityList} />
      </div>

      <SettingsRefereeSection controller={controller} />
      {settingsSection === "main" && auth && canSwitchTestAccount ? (
        <details className="settings-test-account-switcher">
          <summary>테스트 계정 전환</summary>
          <form className="settings-test-account-form" onSubmit={switchTestAccount}>
            <label>
              로그인 ID
              <select value={testLoginId} onChange={(event) => setTestLoginId(event.target.value)}>
                {auth.testAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.id} · {account.label}</option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={auth.testLoginPending || !testLoginId || testLoginId === controller.currentTestLoginId}
            >
              <ArrowRightLeft size={16} /> 전환
            </Button>
          </form>
          {testSwitchStatus ? <p className="form-status form-status-error" role="alert">{testSwitchStatus}</p> : null}
        </details>
      ) : null}
      {settingsSection === "main" && auth?.configured && !controller.currentTestLoginId ? (
        <section className="settings-auth-identities" aria-labelledby="settings-auth-identities-title">
          {validRequestedProviderId && !requestedProviderLinked ? (
            <p className="settings-auth-recovery-callout">
              기존 아이디로 로그인했습니다. 이제 {getAuthProviderLabel(validRequestedProviderId)} 로그인을 이 프로필에 연결하세요.
            </p>
          ) : null}
          <div className="settings-auth-identities-copy">
            <p className="eyebrow">LOGIN CONNECTION</p>
            <h2 id="settings-auth-identities-title">연결된 로그인</h2>
            <p>같은 프로필로 사용할 로그인만 직접 연결하세요. 이메일이나 프로필 해시태그만으로 계정을 합치지 않습니다.</p>
          </div>
          <div className="settings-auth-identity-list">
            {linkedProviderIds.map((providerId) => (
              <div className="settings-auth-identity-row ui-control-surface" key={providerId}>
                <AuthProviderIcon providerId={providerId} className="settings-auth-provider-mark" />
                <strong>{getAuthProviderLabel(providerId)}</strong>
                <span>연결됨</span>
              </div>
            ))}
            {connectableProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="secondary"
                disabled={auth.authActionPending}
                onClick={() => void linkIdentity(provider.id)}
              >
                <AuthProviderIcon providerId={provider.id} /> {provider.id === validRequestedProviderId ? "연결 마무리" : `${provider.label} 연결`}
              </Button>
            ))}
          </div>
          {identityStatus ? (
            <p className={`form-status${identityStatusTone === "error" ? " form-status-error" : ""}`} role="status">
              {identityStatus}
            </p>
          ) : null}
        </section>
      ) : null}
      {settingsSection === "main" && auth ? (
        <div className="ui-action-row settings-signout-row">
          <Button type="button" variant="danger" onClick={() => window.confirm("로그아웃하시겠습니까?") && void auth.signOut()} disabled={auth.authActionPending}>
            <LogOut size={16} /> 로그아웃
          </Button>
          {!controller.currentTestLoginId ? (
            <Button type="button" variant="secondary" onClick={() => { setWithdrawalAcknowledged(false); setWithdrawalStatus(""); setWithdrawalOpen(true); }} disabled={auth.authActionPending}>
              <Trash2 size={16} /> 회원 탈퇴
            </Button>
          ) : null}
        </div>
      ) : null}
      {withdrawalOpen ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !auth.authActionPending && setWithdrawalOpen(false)}>
          <ModalShell as="div" className="app-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="account-withdrawal-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="account-withdrawal-title">회원 탈퇴</h2>
            <p>탈퇴하면 프로필과 개인 기록은 복구할 수 없습니다.</p>
            <p>다른 참가자의 경기 결과 정합성에 필요한 기록은 익명 처리 후 남을 수 있습니다.</p>
            <p><strong>연결된 모든 로그인 계정은 탈퇴 후 7일 동안 다시 가입할 수 없습니다.</strong></p>
            <label className="app-confirm-acknowledgement">
              <input type="checkbox" checked={withdrawalAcknowledged} onChange={(event) => setWithdrawalAcknowledged(event.target.checked)} disabled={auth.authActionPending} />
              기록 삭제와 7일 재가입 제한을 확인했습니다.
            </label>
            {withdrawalStatus ? <p className="form-warning" role="alert">{withdrawalStatus}</p> : null}
            <div className="ui-action-row app-confirm-actions">
              <Button type="button" variant="secondary" onClick={() => setWithdrawalOpen(false)} disabled={auth.authActionPending}>취소</Button>
              <Button type="button" variant="danger" onClick={withdrawAccount} disabled={auth.authActionPending || !withdrawalAcknowledged}>
                {auth.authActionPending ? "처리 중" : "영구 탈퇴"}
              </Button>
            </div>
          </ModalShell>
        </div>
      ) : null}
      <SettingsListDialog
        kind={activityList}
        controller={controller}
        onClose={() => setActivityList("")}
        onOpenDetail={(detail) => {
          setActivityList("");
          setActivityDetail(detail);
        }}
      />
      <SettingsActivityDialog detail={activityDetail} controller={controller} onClose={() => setActivityDetail(null)} />
    </div>
  );
}
