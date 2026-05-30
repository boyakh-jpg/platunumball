import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";

export default function Settings({ app }) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>설정</h1>
        </div>
      </header>
      <div className="content-grid">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">데이터 모드</p>
              <h2>{isSupabaseConfigured ? "Supabase" : "localStorage mock"}</h2>
            </div>
            <Badge tone={isSupabaseConfigured ? "green" : "orange"}>{isSupabaseConfigured ? "연결됨" : "Mock"}</Badge>
          </div>
          <p className="muted">Supabase 환경변수가 없으면 이 브라우저의 localStorage에 샘플 데이터가 저장됩니다.</p>
        </Card>
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">초기화</p>
              <h2>샘플 데이터 복원</h2>
            </div>
          </div>
          <Button variant="secondary" onClick={app.actions.reset}>Mock 데이터 초기화</Button>
        </Card>
      </div>
    </div>
  );
}
