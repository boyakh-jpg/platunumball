import { useMemo, useState } from "react";
import { ShieldCheck, UserRound } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";

export default function Settings({ app, auth }) {
  const privacy = app.state.settings?.privacy ?? {};
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const [blockUserId, setBlockUserId] = useState(app.state.users.find((user) => user.id !== app.currentUserId)?.id ?? "");
  const [reportMatchId, setReportMatchId] = useState(app.state.matches[0]?.id ?? "");
  const [reportReason, setReportReason] = useState("경기 기록 확인이 필요합니다.");
  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const matchMap = Object.fromEntries(app.state.matches.map((match) => [match.id, match]));

  const blockableUsers = useMemo(
    () => app.state.users.filter((user) => user.id !== app.currentUserId && !blockedUserIds.includes(user.id)),
    [app.currentUserId, app.state.users, blockedUserIds],
  );
  const selectedBlockUserId = blockableUsers.some((user) => user.id === blockUserId) ? blockUserId : blockableUsers[0]?.id ?? "";
  const selectedReportMatchId = app.state.matches.some((match) => match.id === reportMatchId) ? reportMatchId : app.state.matches[0]?.id ?? "";

  const submitBlock = (event) => {
    event.preventDefault();
    if (selectedBlockUserId) app.actions.blockUser(selectedBlockUserId);
  };
  const submitReport = (event) => {
    event.preventDefault();
    if (selectedReportMatchId) app.actions.reportMatch(selectedReportMatchId, reportReason);
  };

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
            <p className="muted">현재 앱은 Supabase의 `rankball_state` JSON 상태를 공유합니다. 로그인 세션과 현재 플레이어 선택은 이 브라우저에 따로 저장됩니다.</p>
            {auth?.user ? <p className="form-help">로그인: {auth.user.user_metadata?.providerName ?? auth.user.email} 테스트 세션</p> : null}
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
              <select value={app.currentUserId} onChange={(event) => app.actions.switchUser(event.target.value)}>
                {app.state.users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name} · {user.region} · {user.position}</option>
                ))}
              </select>
            </label>
            <p className="form-help">팀장 권한, 경기 전 동의, 결과 승인 흐름을 사용자별로 확인할 수 있습니다.</p>
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
              <label>
                <input
                  type="checkbox"
                  checked={privacy.regionRanking !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ regionRanking: event.target.checked })}
                />
                지역 랭킹에 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={privacy.teamHistory !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ teamHistory: event.target.checked })}
                />
                소속팀 히스토리 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={privacy.statSummary !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ statSummary: event.target.checked })}
                />
                개인 스탯 요약 표시
              </label>
            </div>
            <p className="form-help">토글 상태는 Supabase 공유 상태에 저장됩니다.</p>
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
                <p className="eyebrow">차단</p>
                <h2>플레이어 숨김</h2>
              </div>
              <Badge tone={blockedUserIds.length ? "orange" : "neutral"}>{blockedUserIds.length}명</Badge>
            </div>
            <form className="form-stack" onSubmit={submitBlock}>
              <label>
                차단할 플레이어
                <select value={selectedBlockUserId} onChange={(event) => setBlockUserId(event.target.value)}>
                  {blockableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.region}</option>)}
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={!selectedBlockUserId}>차단</Button>
            </form>
            <div className="compact-list">
              {blockedUserIds.length ? blockedUserIds.map((userId) => (
                <div key={userId}>
                  <span>{userMap[userId]?.name ?? "플레이어"}</span>
                  <button type="button" onClick={() => app.actions.unblockUser(userId)}>해제</button>
                </div>
              )) : <div><span>차단한 플레이어가 없습니다.</span><strong>0</strong></div>}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">신고</p>
                <h2>경기 기록 신고</h2>
              </div>
              <Badge tone={app.state.reports?.length ? "orange" : "neutral"}>{app.state.reports?.length ?? 0}건</Badge>
            </div>
            <form className="form-stack" onSubmit={submitReport}>
              <label>
                경기
                <select value={selectedReportMatchId} onChange={(event) => setReportMatchId(event.target.value)}>
                  {app.state.matches.map((match) => <option key={match.id} value={match.id}>{match.title}</option>)}
                </select>
              </label>
              <label>
                사유
                <textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} />
              </label>
              <Button type="submit" variant="secondary" disabled={!selectedReportMatchId}>신고 접수</Button>
            </form>
            <div className="compact-list">
              {app.state.reports?.slice(0, 4).map((report) => (
                <div key={report.id}>
                  <span>{matchMap[report.targetId]?.title ?? "경기"} · {report.reason}</span>
                  <strong>{report.status}</strong>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
