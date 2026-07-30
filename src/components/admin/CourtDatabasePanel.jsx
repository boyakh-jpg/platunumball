import useCourtDatabasePanelController from "./useCourtDatabasePanelController.js";
import CourtDatabasePanelView from "./CourtDatabasePanelView.jsx";

export default function CourtDatabasePanel(props) {
  const controller = useCourtDatabasePanelController(props);
  return <CourtDatabasePanelView controller={controller} />;
}
