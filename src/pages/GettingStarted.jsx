import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { isHomeGuideCardVisible } from "../data/settingsMappers.js";
import { assetUrl } from "../lib/assets.js";

import { GUIDE_CHAPTERS } from "./gettingStartedGuideData.jsx";

const GUIDE_CHAPTER_IDS = GUIDE_CHAPTERS.map((chapter) => chapter.id);

export default function GettingStarted({ app }) {
  const [searchParams] = useSearchParams();
  const [homeGuideCardSavePending, setHomeGuideCardSavePending] = useState(false);
  const homeGuideCardSavePendingRef = useRef(false);
  const [homeGuideCardSaveStatus, setHomeGuideCardSaveStatus] = useState("");
  const [chapterMenuOpen, setChapterMenuOpen] = useState(false);
  const chapterTitleRef = useRef(null);
  const requestedChapterId = searchParams.get("chapter") ?? GUIDE_CHAPTER_IDS[0];
  const requestedChapterIndex = GUIDE_CHAPTER_IDS.indexOf(requestedChapterId);
  const activeIndex = requestedChapterIndex >= 0 ? requestedChapterIndex : 0;
  const chapter = GUIDE_CHAPTERS[activeIndex];
  const previousChapterIdRef = useRef(chapter.id);
  const previousChapter = GUIDE_CHAPTERS[activeIndex - 1] ?? null;
  const nextChapter = GUIDE_CHAPTERS[activeIndex + 1] ?? null;
  const CalloutIcon = chapter.callout.Icon;
  const homeGuideCardVisible = isHomeGuideCardVisible(app.state.settings);

  useEffect(() => {
    setChapterMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
    if (previousChapterIdRef.current !== chapter.id) {
      chapterTitleRef.current?.focus({ preventScroll: true });
    }
    previousChapterIdRef.current = chapter.id;
  }, [chapter.id]);

  const toggleHomeGuideCard = async () => {
    if (homeGuideCardSavePendingRef.current) return;
    homeGuideCardSavePendingRef.current = true;
    setHomeGuideCardSavePending(true);
    setHomeGuideCardSaveStatus("저장 중");
    try {
      const saved = await app.actions.updateSettings({
        showHomeGuideCard: !homeGuideCardVisible,
      });
      setHomeGuideCardSaveStatus(saved && saved.ok !== false
        ? "설정과 함께 저장되었습니다."
        : "표시 설정을 저장하지 못했습니다.");
    } catch {
      setHomeGuideCardSaveStatus("표시 설정을 저장하지 못했습니다.");
    } finally {
      homeGuideCardSavePendingRef.current = false;
      setHomeGuideCardSavePending(false);
    }
  };

  return (
    <div className="getting-started-page">
      <div className="getting-started-topbar">
        <Button
          as={Link}
          variant="secondary"
          size="sm"
          to="/app"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          홈으로
        </Button>
        <span>사용 설명 · {GUIDE_CHAPTERS.length}단계</span>
      </div>

      <nav
        className={`getting-started-chapter-nav ui-panel ui-design-info-surface${chapterMenuOpen ? " is-open" : ""}`}
        aria-label="사용 설명 목차"
      >
        <button
          className="getting-started-chapter-nav__toggle"
          type="button"
          aria-expanded={chapterMenuOpen}
          aria-controls="getting-started-chapter-links"
          onClick={() => setChapterMenuOpen((open) => !open)}
        >
          <span>{activeIndex + 1} / {GUIDE_CHAPTERS.length}</span>
          <strong>{chapter.navLabel}</strong>
          <small>단계 선택</small>
          <ChevronDown size={17} aria-hidden="true" />
        </button>
        <div className="getting-started-chapter-nav__links" id="getting-started-chapter-links">
          {GUIDE_CHAPTERS.map((item, index) => (
            <Link
              key={item.id}
              className={item.id === chapter.id ? "is-active" : ""}
              to={`?chapter=${item.id}`}
              aria-current={item.id === chapter.id ? "page" : undefined}
              onClick={() => setChapterMenuOpen(false)}
            >
              <span aria-hidden="true">{index + 1}</span>
              {item.navLabel}
            </Link>
          ))}
        </div>
      </nav>

      <Card as="article" className="getting-started-chapter">
        <header className="getting-started-chapter__copy">
          <Badge tone="orange">{activeIndex + 1} / {GUIDE_CHAPTERS.length}</Badge>
          <p className="eyebrow">{chapter.eyebrow}</p>
          <h1 ref={chapterTitleRef} tabIndex={-1}>{chapter.title}</h1>
          <div className="ui-action-row">
            {chapter.actions.map((action) => {
              const ActionIcon = action.Icon;
              return (
                <Link
                  key={action.to}
                  className={`button ui-button button-${action.primary ? "primary" : "secondary"} ui-button-${action.primary ? "primary" : "secondary"} button-md ui-button-md`}
                  to={action.to}
                >
                  {action.primary ? <ActionIcon size={18} aria-hidden="true" /> : null}
                  {action.label}
                  {!action.primary ? <ActionIcon size={18} aria-hidden="true" /> : null}
                </Link>
              );
            })}
          </div>
        </header>

        {chapter.practicePreview || chapter.previewItems ? (
          <div className="getting-started-practice-preview ui-panel ui-design-info-surface">
            <ol>
              {(chapter.previewItems ?? [
                { label: "CREATE", title: "경기 만들기" },
                { label: "INVITE", title: "초대·출석" },
                { label: "PLAY", title: "시계·진행" },
                { label: "RECORD", title: "기록·승인" },
              ]).map((item) => (
                <li key={item.label}><strong>{item.label}</strong><span>{item.title}</span></li>
              ))}
            </ol>
          </div>
        ) : (
          <figure className="getting-started-shot ui-design-borderless-surface">
            <img
              src={assetUrl(chapter.image)}
              alt={chapter.imageAlt}
              loading="eager"
              decoding="async"
            />
            <figcaption>{chapter.caption}</figcaption>
          </figure>
        )}
      </Card>

      <section className="getting-started-section" aria-labelledby="getting-started-steps-title">
        <div className="section-title-row getting-started-section__head">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2 id="getting-started-steps-title">{chapter.navLabel} 흐름</h2>
          </div>
          <span>{activeIndex + 1} / {GUIDE_CHAPTERS.length}</span>
        </div>
        <ol className="getting-started-steps ui-design-borderless-list">
          {chapter.steps.map(({ title, body, Icon }, index) => (
            <li className="getting-started-step ui-panel" key={title}>
              <div>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Icon size={21} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Card as="aside" className="getting-started-callout">
        <span className="getting-started-callout__icon">
          <CalloutIcon size={25} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">CHECK POINT</p>
          <h2>{chapter.callout.title}</h2>
          <p>{chapter.callout.body}</p>
          <ul>
            {chapter.callout.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
          {chapter.id === "start" ? <Link to="/terms#terms-fees">무료 범위 보기</Link> : null}
        </div>
      </Card>

      {chapter.id === "practice" ? (
        <section className="getting-started-home-guide-setting ui-panel ui-design-info-surface" aria-labelledby="home-guide-setting-title">
          <div>
            <p className="eyebrow">HOME GUIDE</p>
            <h2 id="home-guide-setting-title">홈 안내 카드</h2>
            <small role="status">{homeGuideCardSaveStatus || "선택 즉시 설정에 저장됩니다."}</small>
          </div>
          <Button
            type="button"
            variant="secondary"
            aria-pressed={!homeGuideCardVisible}
            disabled={homeGuideCardSavePending}
            onClick={() => void toggleHomeGuideCard()}
          >
            {homeGuideCardVisible ? "홈에서 사용 설명 안 보기" : "홈에 사용 설명 다시 표시"}
          </Button>
        </section>
      ) : null}

      <nav className="getting-started-pager" aria-label="사용 설명 이전 다음">
        {previousChapter ? (
          <Button
            as={Link}
            variant="secondary"
            size="sm"
            to={`?chapter=${previousChapter.id}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            이전
          </Button>
        ) : <span />}
        <span>{chapter.navLabel} · {activeIndex + 1}/{GUIDE_CHAPTERS.length}</span>
        {nextChapter ? (
          <Button
            as={Link}
            size="sm"
            to={`?chapter=${nextChapter.id}`}
          >
            다음
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button
            as={Link}
            size="sm"
            to="/app"
          >
            완료
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        )}
      </nav>
    </div>
  );
}
