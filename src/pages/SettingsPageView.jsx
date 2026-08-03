import { Link } from "react-router-dom";
import { LogOut } from "lucide-react";
import Button from "../components/common/Button.jsx";
import SettingsPrimaryColumn from "./SettingsPrimaryColumn.jsx";
import SettingsSideColumn from "./SettingsSideColumn.jsx";
import SettingsRefereeSection from "./SettingsRefereeSection.jsx";

export default function SettingsPageView({ controller, auth }) {
  const { sectionMeta, settingsSection } = controller;
  return (
<div className={`page-stack settings-page settings-section-${settingsSection}`}>
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

        <SettingsSideColumn controller={controller} />
      </div>

      <SettingsRefereeSection controller={controller} />
      {settingsSection === "main" && auth ? (
        <div className="ui-action-row settings-signout-row">
          <Button type="button" variant="secondary" onClick={auth.signOut} disabled={auth.authActionPending}>
            <LogOut size={16} /> 로그아웃
          </Button>
        </div>
      ) : null}
    </div>
  );
}
