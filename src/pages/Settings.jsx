import { ShieldCheck, UserRound } from "lucide-react";
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
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">데이터 모드</p>
                <h2>{isSupabaseConfigured ? "Supabase" : "localStorage demo"}</h2>
              </div>
              <Badge tone={isSupabaseConfigured ? "green" : "orange"}>{isSupabaseConfigured ? "연결됨" : "Demo"}</Badge>
            </div>
            <p className="muted">Supabase 환경변수가 있으면 모든 브라우저가 같은 JSON 상태를 공유합니다. 없으면 이 브라우저의 localStorage에 샘플 데이터가 저장됩니다.</p>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">데모 로그인</p>
                <h2>현재 플레이어 전환</h2>
              </div>
              <UserRound size={22} />
            </div>
            <label>
              접속 플레이어
              <select value={app.state.currentUserId} onChange={(event) => app.actions.switchUser(event.target.value)}>
                {app.state.users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name} · {user.region} · {user.position}</option>
                ))}
              </select>
            </label>
            <p className="form-help">팀장 권한, 경기 동의, 결과 승인 흐름을 사용자별로 확인할 수 있습니다.</p>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">공개 범위</p>
                <h2>프로필 표시</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="settings-toggle-grid">
              <label><input type="checkbox" defaultChecked /> 지역 랭킹에 표시</label>
              <label><input type="checkbox" defaultChecked /> 소속팀 히스토리 표시</label>
              <label><input type="checkbox" defaultChecked /> 개인 스탯 요약 표시</label>
            </div>
            <p className="form-help">현재 MVP에서는 화면 상태만 제공하며, 실제 공개 범위 저장은 다음 Supabase 테이블 분리 때 연결합니다.</p>
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">초기화</p>
                <h2>샘플 데이터 복원</h2>
              </div>
            </div>
            <p className="muted">로컬 저장값과 Supabase 공유 상태를 샘플 데이터 기준으로 다시 맞춥니다.</p>
            <Button variant="secondary" onClick={app.actions.reset}>데모 데이터 초기화</Button>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">안전장치</p>
                <h2>차단/신고/약관</h2>
              </div>
            </div>
            <div className="compact-list">
              <div><span>차단 목록</span><strong>0명</strong></div>
              <div><span>신고된 경기</span><strong>0건</strong></div>
              <div><span>약관 버전</span><strong>MVP-0.2</strong></div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
