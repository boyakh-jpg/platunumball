import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Card from "../common/Card.jsx";

export default function RequireAdmin({ app, children }) {
  const loadAdminContext = app.actions.loadAdminContext;
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let mounted = true;
    setStatus("checking");
    Promise.resolve(loadAdminContext?.(true))
      .then((context) => {
        if (mounted) setStatus(Number(context?.level ?? 0) >= 30 ? "allowed" : "denied");
      })
      .catch(() => {
        if (mounted) setStatus("denied");
      });
    return () => {
      mounted = false;
    };
  }, [app.currentUserId, loadAdminContext]);

  if (status === "checking") return <BasketballLoader overlay label="관리자 권한 확인 중" />;
  if (status === "denied") {
    return (
      <div className="page-stack admin-page">
        <Card className="section-card admin-denied-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Admin</p>
                <h1>관리자 권한 없음</h1>
              </div>
            <ShieldCheck size={22} />
          </div>
        </Card>
      </div>
    );
  }
  return children;
}
