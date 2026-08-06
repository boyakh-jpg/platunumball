import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { postServerAction } from "../../lib/serverActions.js";
import { preferExactSearchMatches } from "../../../shared/lib/fuzzyText.js";

function normalizeSearchText(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getSearchLengthText(value = "") {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function getQueryMinSearchLength(value = "", fallback = 2) {
  const text = getSearchLengthText(value);
  if (!text) return fallback;
  if (text.startsWith("#")) return 2;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text)) return 2;
  return 4;
}

function getDefaultSearchText(item = {}) {
  if (typeof item === "string") return item;
  return [
    item.searchText,
    item.haystack,
    item.label,
    item.title,
    item.name,
    item.handle,
    item.hashtag,
    item.meta,
    item.region,
    item.position,
    item.homeCourt,
    item.court,
    item.type,
  ].filter(Boolean).join(" ");
}

function getSearchScore(text = "", query = "") {
  if (!query) return 0;
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedText || !normalizedQuery) return -1;
  if (normalizedText === normalizedQuery) return 1000;
  if (normalizedText.startsWith(normalizedQuery)) return 800;
  if (normalizedText.includes(`#${normalizedQuery}`)) return 700;
  if (normalizedText.includes(normalizedQuery)) return 500;
  const compactText = normalizedText.replace(/\s+/g, "");
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (compactText.includes(compactQuery)) return 300;
  return -1;
}

function getItemKey(item = {}, fallbackCategory = "") {
  const entity = item.player ?? item.team ?? item.court ?? item.referee ?? item;
  const category = item.kind ?? entity.kind ?? item.type ?? entity.type ?? fallbackCategory;
  const identity = item.entityId ?? entity.entityId ?? item.id ?? entity.id ?? item.hashtag ?? entity.hashtag ?? item.handle ?? entity.handle;
  const categoryKey = String(category || "entity").toLowerCase() === "profile"
    ? "player"
    : String(category || "entity").toLowerCase();
  if (identity) return `id:${categoryKey}:${identity}`;
  return [
    category,
    item.label ?? entity.label,
    item.name ?? entity.name,
  ].filter(Boolean).join(":");
}

function getItemName(item = {}) {
  const entity = item.player ?? item.team ?? item.court ?? item.referee ?? item;
  return entity.name ?? item.label ?? "";
}

function mergeSearchItems(localItems = [], remoteItems = [], fallbackCategory = "") {
  const seen = new Set();
  return [...localItems, ...remoteItems].filter((item) => {
    const key = getItemKey(item, fallbackCategory);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function SearchPicker({
  value,
  onChange,
  placeholder,
  items,
  renderItem,
  idleItems = [],
  title = "검색 결과",
  idleTitle = "즐겨찾기",
  emptyText = "검색 결과 없음",
  limit = 10,
  detailLimit = 24,
  loadMoreStep = 0,
  remoteLimit = null,
  minSearchLength = 2,
  getSearchText = getDefaultSearchText,
  remoteSearchType = "",
  remoteSearchPublic = false,
  remoteSearchContext = null,
  remoteSearchOnFocus = false,
  mapRemoteItem = (item) => item,
  showIdleOnFocus = false,
  floating = false,
  floatingHeightLimit = 320,
  preferAboveOnMobile = false,
  className = "",
  fieldClassName = "",
  resultsClassName = "",
  closeOnResultClick = false,
}) {
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showIdlePanel, setShowIdlePanel] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(Math.max(1, Number(limit) || 10));
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [remoteRetrySequence, setRemoteRetrySequence] = useState(0);
  const [floatingPlacement, setFloatingPlacement] = useState("below");
  const [floatingMaxHeight, setFloatingMaxHeight] = useState(320);
  const pickerRef = useRef(null);
  const inputRef = useRef(null);
  const resultsId = useId();
  const remoteRequestIdRef = useRef(0);
  const query = value.trim();
  const baseLimit = Math.max(1, Number(limit) || 10);
  const maxDetailLimit = Math.max(baseLimit, Number(detailLimit) || baseLimit);
  const detailStep = Math.max(0, Number(loadMoreStep) || 0);
  const remoteSearchKey = Array.isArray(remoteSearchType) ? remoteSearchType.join(",") : String(remoteSearchType || "");
  const remoteSearchCategory = typeof remoteSearchType === "string" ? remoteSearchType : "";
  const remoteSearchContextKey = useMemo(() => {
    if (!remoteSearchContext) return "";
    try {
      return JSON.stringify(remoteSearchContext);
    } catch {
      return "";
    }
  }, [remoteSearchContext]);
  const normalizedFloatingHeightLimit = Math.max(96, Number(floatingHeightLimit) || 320);
  const dynamicMinSearchLength = getQueryMinSearchLength(query, minSearchLength);
  const forceSearch = Boolean(query && submittedQuery === query);
  const canSearch = forceSearch || getSearchLengthText(query).length >= dynamicMinSearchLength;
  const canRemoteSearch = canSearch || (remoteSearchOnFocus && focused);
  const mappedRemoteItems = useMemo(() => remoteItems.map(mapRemoteItem).filter(Boolean), [mapRemoteItem, remoteItems]);
  const activeItems = useMemo(() => {
    if (!canSearch) return mergeSearchItems(idleItems, mappedRemoteItems, remoteSearchCategory);
    const localItems = (items ?? [])
      .map((item, index) => ({
        item,
        index,
        score: getSearchScore(getSearchText(item), query),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.item);
    return preferExactSearchMatches(
      mergeSearchItems(localItems, mappedRemoteItems, remoteSearchCategory),
      query,
      getItemName,
    );
  }, [canSearch, getSearchText, idleItems, items, mappedRemoteItems, query, remoteSearchCategory]);
  const canShow = floating
    ? focused && (canSearch || showIdleOnFocus)
    : canSearch || (showIdleOnFocus && focused);
  const currentVisibleLimit = detailStep ? Math.min(visibleLimit, maxDetailLimit) : (expanded ? maxDetailLimit : baseLimit);
  const visibleItems = activeItems.slice(0, currentVisibleLimit);
  const hasMore = activeItems.length > currentVisibleLimit && currentVisibleLimit < maxDetailLimit;
  const resultTitle = query ? title : idleTitle;
  const showIdleToggle = Boolean(query && canSearch && idleItems.length);
  const closeResults = () => {
    setFocused(false);
    setExpanded(false);
    setShowIdlePanel(false);
    setVisibleLimit(baseLimit);
  };
  const moveResultFocus = (event, direction) => {
    const focusable = [...(pickerRef.current?.querySelectorAll(".search-picker-results button:not(:disabled), .search-picker-results a[href], .search-picker-results [tabindex='0']") ?? [])];
    if (!focusable.length) return;
    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : focusable.length - 1
      : (currentIndex + direction + focusable.length) % focusable.length;
    focusable[nextIndex]?.focus();
  };

  useEffect(() => {
    if (!remoteSearchKey || !canRemoteSearch) {
      remoteRequestIdRef.current += 1;
      setRemoteItems([]);
      setRemoteLoading(false);
      setRemoteError(false);
      return undefined;
    }

    const requestId = remoteRequestIdRef.current + 1;
    remoteRequestIdRef.current = requestId;
    setRemoteItems([]);
    setRemoteLoading(true);
    setRemoteError(false);
    const timer = window.setTimeout(async () => {
      try {
        const result = await postServerAction("/api/search", {
          query,
          type: remoteSearchType,
          limit: Math.max(baseLimit, Number(remoteLimit) || baseLimit),
          context: remoteSearchContext,
          force: forceSearch || (remoteSearchOnFocus && !query),
        }, { allowAnonymous: remoteSearchPublic });
        if (remoteRequestIdRef.current !== requestId) return;
        setRemoteItems(Array.isArray(result?.items) ? result.items : []);
      } catch {
        if (remoteRequestIdRef.current === requestId) {
          setRemoteItems([]);
          setRemoteError(true);
        }
      } finally {
        if (remoteRequestIdRef.current === requestId) setRemoteLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [baseLimit, canRemoteSearch, forceSearch, query, remoteLimit, remoteRetrySequence, remoteSearchContextKey, remoteSearchKey, remoteSearchOnFocus, remoteSearchPublic]);

  useEffect(() => {
    setExpanded(false);
    setShowIdlePanel(false);
    setVisibleLimit(baseLimit);
  }, [baseLimit, query]);

  useLayoutEffect(() => {
    if (!floating || !canShow || !pickerRef.current) return undefined;

    const updatePlacement = () => {
      const rect = pickerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const spaceAbove = Math.max(0, rect.top - viewportTop - 12);
      const spaceBelow = Math.max(0, viewportBottom - rect.bottom - 12);
      const preferMobileAbove = preferAboveOnMobile
        && window.matchMedia("(max-width: 759px)").matches
        && spaceAbove >= 220;
      const nextPlacement = preferMobileAbove || (spaceBelow < 220 && spaceAbove > spaceBelow) ? "above" : "below";
      const availableSpace = nextPlacement === "above" ? spaceAbove : spaceBelow;
      const nextMaxHeight = Math.max(0, Math.min(normalizedFloatingHeightLimit, Math.floor(availableSpace)));

      setFloatingPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      setFloatingMaxHeight((current) => (current === nextMaxHeight ? current : nextMaxHeight));
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.visualViewport?.addEventListener("resize", updatePlacement);
    window.visualViewport?.addEventListener("scroll", updatePlacement);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.visualViewport?.removeEventListener("resize", updatePlacement);
      window.visualViewport?.removeEventListener("scroll", updatePlacement);
    };
  }, [canShow, floating, normalizedFloatingHeightLimit, preferAboveOnMobile]);

  return (
    <div ref={pickerRef} className={`search-picker${floating ? " is-floating" : ""}${className ? ` ${className}` : ""}`}>
      <div className={`search-picker-field${fieldClassName ? ` ${fieldClassName}` : ""}`}>
        <Search size={18} />
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          aria-controls={canShow ? resultsId : undefined}
          aria-expanded={canShow}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              moveResultFocus(event, event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closeResults();
              return;
            }
            if (event.key !== "Enter") return;
            event.preventDefault();
            setSubmittedQuery(value.trim());
            setRemoteRetrySequence((current) => current + 1);
            setFocused(true);
            setExpanded(false);
            setShowIdlePanel(false);
            setVisibleLimit(baseLimit);
          }}
          onChange={(event) => {
            setFocused(true);
            setExpanded(false);
            setShowIdlePanel(false);
            setSubmittedQuery("");
            setVisibleLimit(baseLimit);
            onChange(event.target.value);
          }}
        />
      </div>
      {canShow ? (
        <div
          id={resultsId}
          className={`home-search-results unified search-picker-results${floating ? ` is-floating opens-${floatingPlacement}` : ""}${resultsClassName ? ` ${resultsClassName}` : ""}`}
          style={floating ? { "--search-picker-max-height": `${floatingMaxHeight}px` } : undefined}
          onPointerDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              moveResultFocus(event, event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeResults();
              inputRef.current?.focus();
            }
          }}
          onClickCapture={(event) => {
            if (!closeOnResultClick || event.target?.closest?.(".search-picker-more, .home-search-more, .search-picker-idle-toggle, .search-picker-retry")) return;
            window.setTimeout(closeResults, 0);
          }}
        >
          {resultTitle ? <strong className="search-picker-title">{resultTitle}</strong> : null}
          {showIdleToggle ? (
            <>
              <button
                type="button"
                className="search-picker-idle-toggle"
                aria-expanded={showIdlePanel}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowIdlePanel((current) => !current)}
              >
                <span>{idleTitle}</span>
                <b>{idleItems.length}</b>
              </button>
              {showIdlePanel ? (
                <div className="search-picker-idle-panel">
                  {idleItems.map(renderItem)}
                </div>
              ) : null}
            </>
          ) : null}
          {visibleItems.length ? visibleItems.map(renderItem) : <div className="ui-empty-state-compact">{remoteLoading ? "검색 중..." : remoteError ? "검색 결과를 불러오지 못했습니다." : emptyText}</div>}
          {remoteError && !remoteLoading ? (
            <button
              type="button"
              className="button ui-button button-secondary ui-button-secondary button-sm ui-button-sm search-picker-retry"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRemoteRetrySequence((current) => current + 1)}
            >
              누락된 검색 결과 다시 불러오기
            </button>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              className="ui-compact-action home-search-more search-picker-more"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (detailStep) {
                  setVisibleLimit((current) => Math.min(Math.max(current, baseLimit) + detailStep, maxDetailLimit, activeItems.length));
                  return;
                }
                setExpanded(true);
              }}
            >
              더보기
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
