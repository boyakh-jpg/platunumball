import { Link } from "react-router-dom";

const SOURCE_LINKS = [
  {
    label: "공공데이터포털 「전국체육시설표준데이터」",
    href: "https://www.data.go.kr/data/15096288/standard.do",
  },
  {
    label: "공공데이터포털 「전국공공시설개방정보표준데이터」",
    href: "https://www.data.go.kr/data/15013117/standard.do",
  },
  {
    label: "OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
  },
];

export default function DataSources() {
  return (
    <main className="data-sources-page">
      <article className="section-card data-sources-card">
        <header className="data-sources-header">
          <p className="eyebrow">DATA SOURCES</p>
          <h1>데이터 출처</h1>
          <p>본 서비스의 농구장 정보는 다음 공개 데이터를 기반으로 가공되었습니다.</p>
        </header>

        <ul className="data-source-list">
          {SOURCE_LINKS.map((source) => (
            <li key={source.href}>
              <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
            </li>
          ))}
        </ul>

        <p className="data-license-note">
          OpenStreetMap 데이터는 <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database License(ODbL)</a>에 따라 이용됩니다.
        </p>

        <div className="data-source-notice">
          <p>시설의 운영 여부, 이용시간, 요금, 예약 조건 및 출입 가능 여부는 실제 현장 및 관리기관의 최신 정보와 다를 수 있습니다. 방문 전 해당 시설 또는 관리기관에 확인하시기 바랍니다.</p>
          <p>농구장 정보의 오류, 폐쇄 또는 이용 제한이 확인된 경우 <Link to="/app/settings">서비스 내 신고 기능</Link>을 통해 알려주시기 바랍니다.</p>
        </div>

        <Link className="data-sources-home-link" to="/">홈으로 돌아가기</Link>
      </article>
    </main>
  );
}
