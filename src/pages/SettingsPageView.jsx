import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, LogOut, Trash2 } from "lucide-react";
import Button from "../components/common/Button.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import SettingsPrimaryColumn from "./SettingsPrimaryColumn.jsx";
import SettingsSideColumn from "./SettingsSideColumn.jsx";
import SettingsRefereeSection from "./SettingsRefereeSection.jsx";
import SettingsActivityDialog from "./SettingsActivityDialog.jsx";
import SettingsListDialog from "./SettingsListDialog.jsx";

export default function SettingsPageView({ controller, auth }) {
  const { sectionMeta, settingsSection, selectedReportCourtRequest } = controller;
  const canSwitchTestAccount = controller.serverAdminLevel >= 100 || Boolean(controller.currentTestLoginId);
  const [activityDetail, setActivityDetail] = useState(null);
  const [activityList, setActivityList] = useState("");
  const [testLoginId, setTestLoginId] = useState(() => controller.currentTestLoginId || auth?.testAccounts?.[0]?.id || "");
  const [testSwitchStatus, setTestSwitchStatus] = useState("");
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [withdrawalAcknowledged, setWithdrawalAcknowledged] = useState(false);
  const [withdrawalStatus, setWithdrawalStatus] = useState("");
  useBodyScrollLock(withdrawalOpen || Boolean(activityList) || Boolean(activityDetail));

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
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="account-withdrawal-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="account-withdrawal-title">회원 탈퇴</h2>
            <p>탈퇴하면 프로필과 개인 기록은 복구할 수 없습니다.</p>
            <p>다른 참가자의 경기 결과 정합성에 필요한 기록은 익명 처리 후 남을 수 있습니다.</p>
            <p><strong>탈퇴한 Google 계정은 7일 동안 다시 가입할 수 없습니다.</strong></p>
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
          </div>
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
