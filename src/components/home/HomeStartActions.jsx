import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, ClipboardCheck } from "lucide-react";
import { HOME_START_LINKS, HOME_RECORD_LINKS } from "../../lib/appNavigation.js";

function StartLink({ item }) {
  const Icon = item.icon;
  return (
    <Link className="home-start-action" to={item.to}>
      <Icon size={20} aria-hidden="true" />
      <span><strong>{item.label}</strong><small>{item.description}</small></span>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

export default function HomeStartActions() {
  const [recordsOpen, setRecordsOpen] = useState(false);
  const recordOptionsId = useId();
  return (
    <div className="home-start">
      <nav className="home-start-actions" aria-label="홈에서 시작하기">
        {HOME_START_LINKS.map((item) => <StartLink key={item.to} item={item} />)}
        <button
          className="home-start-action"
          type="button"
          aria-expanded={recordsOpen}
          aria-controls={recordOptionsId}
          onClick={() => setRecordsOpen((open) => !open)}
        >
          <ClipboardCheck size={20} aria-hidden="true" />
          <span><strong>기록 남기기</strong><small>점수 공유 또는 경기 기록</small></span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </nav>
      <div id={recordOptionsId} className="home-record-options" hidden={!recordsOpen}>
        {HOME_RECORD_LINKS.map((item) => <StartLink key={item.to} item={item} />)}
      </div>
    </div>
  );
}
