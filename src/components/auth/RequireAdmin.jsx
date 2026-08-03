import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";

export default function RequireAdmin({ app, children }) {
  const loadAdminContext = app.actions.loadAdminContext;
  const [status, setStatus] = useState("checking");
  const [retrySequence, setRetrySequence] = useState(0);

  useEffect(() => {
    let mounted = true;
    setStatus("checking");
    Promise.resolve(loadAdminContext?.(true))
      .then((context) => {
        if (!mounted) return;
        setStatus(context?.loadError ? "error" : Number(context?.level ?? 0) >= 30 ? "allowed" : "denied");
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [app.currentUserId, loadAdminContext, retrySequence]);

  if (status === "checking") return <BasketballLoader overlay label="관리자 권한 확인 중" />;
  if (status === "error") {
    return (
      <div className="page-stack admin-page">
        <Card className="section-card admin-denied-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Admin</p>
              <h1>관리자 권한을 확인하지 못했습니다</h1>
              <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            </div>
            <ShieldCheck size={22} />
          </div>
          <Button type="button" variant="secondary" onClick={() => setRetrySequence((current) => current + 1)}>다시 시도</Button>
        </Card>
      </div>
    );
  }
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
