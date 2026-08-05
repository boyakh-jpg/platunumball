import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, LogOut } from "lucide-react";
import Button from "../components/common/Button.jsx";
import SettingsPrimaryColumn from "./SettingsPrimaryColumn.jsx";
import SettingsSideColumn from "./SettingsSideColumn.jsx";
import SettingsRefereeSection from "./SettingsRefereeSection.jsx";
import SettingsActivityDialog from "./SettingsActivityDialog.jsx";

export default function SettingsPageView({ controller, auth }) {
  const { sectionMeta, settingsSection, selectedReportCourtRequest } = controller;
  const canSwitchTestAccount = controller.serverAdminLevel >= 100 || Boolean(controller.currentTestLoginId);
  const [activityDetail, setActivityDetail] = useState(null);
  const [testLoginId, setTestLoginId] = useState(() => controller.currentTestLoginId || auth?.testAccounts?.[0]?.id || "");
  const [testSwitchStatus, setTestSwitchStatus] = useState("");

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

        <SettingsSideColumn controller={controller} onOpenDetail={setActivityDetail} />
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
          <Button type="button" variant="danger" onClick={auth.signOut} disabled={auth.authActionPending}>
            <LogOut size={16} /> 로그아웃
          </Button>
        </div>
      ) : null}
      <SettingsActivityDialog detail={activityDetail} controller={controller} onClose={() => setActivityDetail(null)} />
    </div>
  );
}
