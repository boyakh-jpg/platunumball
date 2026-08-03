import useSettingsPageController from "./useSettingsPageController.jsx";
import SettingsPageView from "./SettingsPageView.jsx";
import "../styles/recruiting-arena.css";

export default function Settings(props) {
  const controller = useSettingsPageController(props);
  return <SettingsPageView controller={controller} auth={props.auth} />;
}
