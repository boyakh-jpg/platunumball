import { Link } from "react-router-dom";
import LegalDocumentPage from "../components/legal/LegalDocumentPage.jsx";

const EFFECTIVE_DATE = "2026년 7월 22일";

export default function Privacy() {
  return (
    <LegalDocumentPage
      eyebrow="PRIVACY"
      title="개인정보처리방침"
      lead="BOXTIER는 농구 경기 모집·기록·랭킹 서비스를 제공하는 데 필요한 개인정보만 처리하고, 이용자가 자신의 정보 처리 내용을 확인하고 통제할 수 있도록 합니다."
      effectiveDate={EFFECTIVE_DATE}
    >
      <aside className="legal-summary" aria-label="핵심 요약">
        <strong>핵심 요약</strong>
        <ul>
          <li>Google 로그인 계정 정보와 이용자가 입력한 프로필·경기 활동 정보를 처리합니다.</li>
          <li>Discord 연동은 선택이며 언제든 연결을 해제할 수 있습니다.</li>
          <li>프로필 공개 범위 일부는 설정에서 직접 끌 수 있습니다.</li>
          <li>Google 계정 비밀번호와 주민등록번호는 수집하지 않습니다.</li>
        </ul>
      </aside>

      <nav className="legal-toc" aria-label="개인정보처리방침 목차">
        <strong>목차</strong>
        <ol>
          <li><a href="#privacy-purpose">처리 목적·항목·보유기간</a></li>
          <li><a href="#privacy-method">수집 방법과 처리 근거</a></li>
          <li><a href="#privacy-external-login">외부 로그인 및 연동 서비스</a></li>
          <li><a href="#privacy-public">다른 이용자에게 공개되는 정보</a></li>
          <li><a href="#privacy-third-party">제3자 제공</a></li>
          <li><a href="#privacy-outsourcing">처리위탁과 국외 이전</a></li>
          <li><a href="#privacy-storage">쿠키·브라우저 저장소</a></li>
          <li><a href="#privacy-rights">이용자와 법정대리인의 권리</a></li>
          <li><a href="#privacy-children">만 14세 미만 이용자</a></li>
          <li><a href="#privacy-destruction">파기와 안전조치</a></li>
          <li><a href="#privacy-contact">문의·권익침해 구제</a></li>
          <li><a href="#privacy-change">방침 변경</a></li>
        </ol>
      </nav>

      <section id="privacy-purpose">
        <h2>1. 처리 목적·항목·보유기간</h2>
        <p>운영팀은 아래 목적에 필요한 범위에서 개인정보를 처리합니다. 법령에 별도 보존 의무가 있거나 신고·분쟁 처리가 진행 중인 경우에는 해당 목적에 필요한 최소 정보만 분리하여 보관할 수 있습니다.</p>
        <div className="legal-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">구분</th>
                <th scope="col">처리 항목</th>
                <th scope="col">목적</th>
                <th scope="col">보유기간</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">계정·인증</th>
                <td>Supabase 인증 식별자, Google 계정 식별자, 이메일, 이름, 프로필 이미지, 로그인 제공자, 로그인·세션 정보</td>
                <td>회원 식별, 로그인, 계정 보호, 중복 계정 방지</td>
                <td>회원 탈퇴 또는 계정 삭제 처리 시까지</td>
              </tr>
              <tr>
                <th scope="row">프로필</th>
                <td>닉네임, 해시태그, 출생연도, 연령부, 포지션, 시·도와 시·군·구, 소속·팀, 프로필 표시 설정</td>
                <td>프로필 제공, 연령부 산정, 지역·팀·랭킹 기능 운영</td>
                <td>회원 탈퇴 또는 이용자가 삭제·변경할 때까지</td>
              </tr>
              <tr>
                <th scope="row">서비스 활동</th>
                <td>모집방·초대·참가·채팅, 커뮤니티 글·댓글·추천, 경기 일정·출석·결과·개인 기록, 팀·대회, MMR·랭킹·신뢰도, 심판 활동·시험, 즐겨찾기·알림</td>
                <td>경기와 커뮤니티 운영, 기록과 랭킹 계산, 분쟁 처리, 맞춤 목록 제공</td>
                <td>회원 이용 기간 및 각 기록의 운영 목적 달성 시까지</td>
              </tr>
              <tr>
                <th scope="row">신고·운영</th>
                <td>신고자·대상자 식별자, 신고 사유와 메모, 처리 결과, 제재·감사 이력</td>
                <td>안전한 서비스 운영, 부정 이용 방지, 이의·분쟁 처리</td>
                <td>처리 종료 후 3년 또는 관련 분쟁 종료 시까지</td>
              </tr>
              <tr>
                <th scope="row">구장</th>
                <td>신청자 식별자, 핀·현장 좌표와 정확도, 현장 사진, 주소, 시설명·운영 정보·연락처·URL, AI 검증 결과, 리뷰와 신고 내용</td>
                <td>구장 등록·중복 확인·현장 및 AI 검수·검색·리뷰 제공</td>
                <td>구장 정보 운영 기간. 신청자 식별정보는 탈퇴 또는 검수 목적 달성 시까지</td>
              </tr>
              <tr>
                <th scope="row">Discord 선택 연동</th>
                <td>Discord 사용자 ID, 사용자명·표시명, 아바타 URL, 연동 시각, 알림 전송 상태, 연동 채팅 내용</td>
                <td>계정 연결, 선택한 알림 전송, 방 채팅 연동</td>
                <td>연결 해제 또는 회원 탈퇴 시까지. 임시 OAuth 증명은 최대 10분</td>
              </tr>
              <tr>
                <th scope="row">자동 생성 정보</th>
                <td>IP 주소, 접속 시각, 요청 기록, 브라우저·기기 정보, 오류·보안 로그가 호스팅·인증 제공자에서 생성될 수 있음</td>
                <td>서비스 제공, 보안, 장애 대응, 부정 이용 탐지</td>
                <td>각 제공자의 운영·보안 보존 기준 또는 관련 법령상 기간</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="legal-note">회원 탈퇴 뒤에도 참가자 전체의 경기 결과와 팀 전적 정합성을 위해 필요한 기록은 이용자를 직접 식별하기 어렵게 처리한 뒤 보존할 수 있습니다.</p>
      </section>

      <section id="privacy-method">
        <h2>2. 수집 방법과 처리 근거</h2>
        <ul>
          <li>Google OAuth 로그인, 프로필 설정, 구장 신청, 경기·팀·신고 등 이용자가 직접 입력하거나 수행한 활동을 통해 수집합니다.</li>
          <li>서비스 접속 과정에서 인증 세션, 접속·오류·보안 기록이 자동으로 생성될 수 있습니다.</li>
          <li>회원가입과 서비스 제공에 필수적인 정보는 이용계약 체결·이행을 위해 처리하고, 선택 기능은 이용자의 선택 또는 동의를 근거로 처리합니다.</li>
          <li>Google 계정 비밀번호는 BOXTIER가 받거나 저장하지 않습니다.</li>
        </ul>
      </section>

      <section id="privacy-external-login">
        <h2>3. 외부 로그인 및 연동 서비스</h2>
        <p>BOXTIER는 회원 인증과 Discord 연동 기능을 제공하기 위해 다음 외부 서비스를 이용합니다.</p>
        <div className="legal-provider-grid">
          <article>
            <h3>Google</h3>
            <dl>
              <div><dt>제공받는 정보</dt><dd>이메일 주소, 이름, 프로필 이미지, Google 계정 식별자</dd></div>
              <div><dt>이용 목적</dt><dd>회원가입, 로그인, 계정 식별</dd></div>
            </dl>
          </article>
          <article>
            <h3>Discord</h3>
            <dl>
              <div><dt>제공받는 정보</dt><dd>Discord 사용자 식별자, 사용자명·표시명, 프로필 이미지</dd></div>
              <div><dt>이용 목적</dt><dd>Discord 계정 연결, 알림 전송, 선택적 방 채팅 연동</dd></div>
            </dl>
          </article>
        </div>
        <p className="legal-note">현재 Discord 연동은 <code>identify</code> 권한만 요청하며 이메일 주소를 요청하거나 저장하지 않습니다. 향후 이메일 등 추가 권한이 필요해지면 요청 전에 이 방침과 동의 화면을 갱신합니다.</p>
      </section>

      <section id="privacy-public">
        <h2>4. 다른 이용자에게 공개되는 정보</h2>
        <p>서비스 성격상 닉네임, 해시태그, 프로필 이미지, 포지션, 연령부, 지역, 소속 팀, 경기·랭킹·신뢰도·심판 활동 일부가 다른 이용자에게 표시될 수 있습니다. 공개방의 글·채팅·경기 결과와 구장 리뷰는 해당 공개 범위의 이용자가 볼 수 있습니다.</p>
        <p><Link to="/app/settings">설정</Link>에서 지역 랭킹, 팀 이력, 통계 요약, 작성 게시글·댓글의 공개 여부를 변경할 수 있습니다. 비공개 설정 전 이미 다른 이용자가 별도로 저장한 정보까지 회수되지는 않습니다.</p>
      </section>

      <section id="privacy-third-party">
        <h2>5. 제3자 제공</h2>
        <p>운영팀은 이용자의 개인정보를 판매하지 않습니다. 다음 경우를 제외하고 개인정보를 제3자에게 제공하지 않습니다.</p>
        <ul>
          <li>이용자가 Discord 연동·알림·채팅 전송처럼 외부 서비스 이용을 직접 선택한 경우</li>
          <li>이용자가 공개방·팀·대회에 정보를 게시하거나 다른 이용자를 초대한 경우</li>
          <li>법령에 근거가 있거나 수사기관 등 적법한 권한을 가진 기관이 요구한 경우</li>
          <li>생명·신체의 급박한 위험을 방지하기 위해 필요한 경우</li>
        </ul>
      </section>

      <section id="privacy-outsourcing">
        <h2>6. 처리위탁과 국외 이전</h2>
        <p>서비스 제공에 필요한 업무 일부를 아래 사업자에게 맡깁니다. 해외 사업자의 인프라를 이용하는 과정에서 개인정보가 암호화된 통신망을 통해 국외에서 처리될 수 있습니다.</p>
        <div className="legal-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">수탁자·외부 서비스</th>
                <th scope="col">업무와 이전 항목</th>
                <th scope="col">이전 국가·시점·방법</th>
                <th scope="col">보유 기준</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Supabase, Inc.</th>
                <td>인증, 데이터베이스, 실시간 데이터 처리. 계정·프로필·서비스 활동 정보</td>
                <td>선택된 프로젝트 리전 및 미국·싱가포르 등 지원 거점, 서비스 이용 시 HTTPS 전송</td>
                <td>회원 탈퇴·삭제 요청 또는 위탁계약 종료 시까지</td>
              </tr>
              <tr>
                <th scope="row">Vercel Inc.</th>
                <td>웹 호스팅, 서버 API, 접속·오류 로그 처리</td>
                <td>미국 등 글로벌 인프라, 접속·API 요청 시 HTTPS 전송</td>
                <td>서비스 운영·보안상 필요한 기간 또는 계약 종료 시까지</td>
              </tr>
              <tr>
                <th scope="row">Cloudflare, Inc.</th>
                <td>이미지 저장·전송, 구장 현장 사진 AI 분석과 네트워크 보호. 업로드 이미지·요청 정보</td>
                <td>미국 등 글로벌 인프라, 업로드·조회 시 암호화 전송</td>
                <td>파일 삭제 또는 계약 종료 시까지</td>
              </tr>
              <tr>
                <th scope="row">Google LLC</th>
                <td>소셜 로그인 본인 확인. Google 계정 식별자·이메일·OAuth 요청 정보</td>
                <td>미국 등 Google 인프라, 로그인 선택 시 HTTPS 전송</td>
                <td>Google 정책 및 연동 해제 시까지</td>
              </tr>
              <tr>
                <th scope="row">Discord Inc.</th>
                <td>선택적 계정 연동, DM 알림, 방 채팅. Discord ID·프로필·알림·채팅 내용</td>
                <td>미국 등 Discord 인프라, 연동·전송 시 HTTPS 또는 Gateway 연결</td>
                <td>연동 해제·전송 목적 달성 또는 Discord 정책상 기간</td>
              </tr>
              <tr>
                <th scope="row">NAVER Cloud Corp.</th>
                <td>지도 표시·주소 확인. 지도 좌표·주소 검색어·요청 정보</td>
                <td>대한민국, 지도 사용 시 암호화 전송</td>
                <td>제공 목적 달성 또는 NAVER Cloud 운영 기준까지</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="legal-note">국외 이전을 원하지 않으면 Discord 연결을 사용하지 않거나 연결을 해제할 수 있습니다. 다만 인증·호스팅처럼 서비스 제공에 필수인 처리를 거부하면 서비스 이용이 제한될 수 있습니다.</p>
      </section>

      <section id="privacy-storage">
        <h2>7. 쿠키·브라우저 저장소</h2>
        <ul>
          <li>Supabase 인증 세션은 로그인 유지와 요청 인증을 위해 브라우저 저장소에 보관될 수 있으며 로그아웃하거나 세션이 만료되면 사용할 수 없게 됩니다.</li>
          <li>Discord OAuth 상태 쿠키는 위·변조 방지를 위해 HttpOnly·Secure·SameSite 속성으로 설정되며 상태 확인용은 최대 10분, 연동 완료 증명용은 최대 5분 뒤 만료됩니다.</li>
          <li>브라우저 설정에서 저장 정보를 지울 수 있으나 로그인 유지나 외부 계정 연동이 중단될 수 있습니다.</li>
        </ul>
      </section>

      <section id="privacy-rights">
        <h2>8. 이용자와 법정대리인의 권리</h2>
        <p>이용자와 법정대리인은 본인 또는 보호 대상 아동의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 동의 철회와 회원 탈퇴를 요구할 수 있습니다. 프로필·공개 설정·Discord 연결은 서비스 설정에서 직접 변경할 수 있고, 직접 처리할 수 없는 요청은 아래 개인정보 문의처로 접수할 수 있습니다.</p>
        <p>운영팀은 요청자의 본인 또는 정당한 법정대리인 여부를 확인할 수 있으며, 다른 사람의 권리 침해나 법령상 보존 의무가 있는 범위에서는 요청이 제한될 수 있습니다.</p>
      </section>

      <section id="privacy-children">
        <h2>9. 만 14세 미만 이용자</h2>
        <p>서비스는 출생연도를 바탕으로 Junior 연령부를 제공하므로 만 14세 미만 이용자가 포함될 수 있습니다. 만 14세 미만 이용자의 개인정보 처리에 동의가 필요한 경우에는 법정대리인의 동의를 받아야 하며, 운영팀은 법정대리인에게 동의 확인 자료와 관계 확인을 요청할 수 있습니다.</p>
        <p className="legal-note">현재 서비스에 별도 법정대리인 동의 확인 절차가 표시되지 않는 경우, 만 14세 미만 이용자는 법정대리인과 함께 운영팀에 먼저 문의한 뒤 가입해야 합니다.</p>
      </section>

      <section id="privacy-destruction">
        <h2>10. 파기와 안전조치</h2>
        <p>보유기간이 끝나거나 처리 목적이 달성되면 복구하기 어려운 방법으로 전자 기록을 삭제하고, 법령상 보관해야 하는 정보는 별도 분리합니다. 백업 데이터는 백업 주기에 따라 순차 삭제됩니다.</p>
        <p>운영팀은 암호화 통신, 인증 토큰 보호, 역할별 접근권한, 데이터베이스 행 단위 접근 제어, 관리자 감사 기록, 비밀키의 서버 분리, 정기적인 보안 점검 등 합리적인 안전조치를 적용합니다.</p>
      </section>

      <section id="privacy-contact">
        <h2>11. 문의·권익침해 구제</h2>
        <dl className="legal-contact-list">
          <div><dt>담당부서</dt><dd>BOXTIER 운영팀</dd></div>
          <div><dt>이메일</dt><dd><a href="mailto:privacy@boxtier.kr">privacy@boxtier.kr</a></dd></div>
          <div><dt>서비스 내 접수</dt><dd><Link to="/app/settings">설정 · 신고 접수</Link></dd></div>
        </dl>
        <p>개인정보 침해 상담이 필요한 경우 개인정보침해신고센터(국번 없이 118), 개인정보분쟁조정위원회(1833-6972), <a href="https://www.privacy.go.kr/" target="_blank" rel="noopener noreferrer">개인정보 포털</a>을 이용할 수 있습니다.</p>
      </section>

      <section id="privacy-change">
        <h2>12. 방침 변경</h2>
        <p>법령, 서비스 또는 처리 방식이 바뀌면 이 방침을 변경할 수 있습니다. 중요한 변경은 시행 전에 서비스 공지 또는 알림으로 안내하고, 이전 버전과 변경일을 확인할 수 있도록 관리합니다.</p>
        <p><strong>공고일·시행일:</strong> {EFFECTIVE_DATE}</p>
      </section>
    </LegalDocumentPage>
  );
}
