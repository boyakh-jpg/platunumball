import useAdminPageController from "./useAdminPageController.jsx";
import AdminPageView from "./AdminPageView.jsx";
import "../styles/recruiting-arena.css";

export default function Admin(props) {
  const controller = useAdminPageController(props);
  return <AdminPageView controller={controller} />;
}
