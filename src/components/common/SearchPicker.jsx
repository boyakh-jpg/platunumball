import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { postServerAction } from "../../lib/serverActions.js";

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

function getItemKey(item = {}) {
  return [item.kind, item.type, item.id, item.label, item.name].filter(Boolean).join(":");
}

function mergeSearchItems(localItems = [], remoteItems = []) {
  const seen = new Set();
  return [...localItems, ...remoteItems].filter((item) => {
    const key = getItemKey(item);
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
  minSearchLength = 2,
  getSearchText = getDefaultSearchText,
  remoteSearchType = "",
  remoteSearchContext = null,
  mapRemoteItem = (item) => item,
  showIdleOnFocus = false,
  floating = false,
  className = "",
  fieldClassName = "",
  resultsClassName = "",
  closeOnResultClick = false,
}) {
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const remoteRequestIdRef = useRef(0);
  const query = value.trim();
  const remoteSearchKey = Array.isArray(remoteSearchType) ? remoteSearchType.join(",") : String(remoteSearchType || "");
  const dynamicMinSearchLength = getQueryMinSearchLength(query, minSearchLength);
  const canSearch = getSearchLengthText(query).length >= dynamicMinSearchLength;
  const mappedRemoteItems = useMemo(() => remoteItems.map(mapRemoteItem).filter(Boolean), [mapRemoteItem, remoteItems]);
  const activeItems = useMemo(() => {
    if (!canSearch) return idleItems;
    const localItems = (items ?? [])
      .map((item, index) => ({
        item,
        index,
        score: getSearchScore(getSearchText(item), query),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.item);
    return mergeSearchItems(localItems, mappedRemoteItems);
  }, [canSearch, getSearchText, idleItems, items, mappedRemoteItems, query]);
  const canShow = floating
    ? focused && (canSearch || showIdleOnFocus)
    : canSearch || (showIdleOnFocus && focused);
  const visibleItems = activeItems.slice(0, expanded ? detailLimit : limit);
  const hasMore = activeItems.length > limit && !expanded;
  const resultTitle = query ? title : idleTitle;
  const closeResults = () => {
    setFocused(false);
    setExpanded(false);
  };

  useEffect(() => {
    if (!remoteSearchKey || !canSearch) {
      setRemoteItems([]);
      setRemoteLoading(false);
      return undefined;
    }

    const requestId = remoteRequestIdRef.current + 1;
    remoteRequestIdRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setRemoteLoading(true);
      try {
        const result = await postServerAction("/api/search", {
          query,
          type: remoteSearchType,
          limit,
          context: remoteSearchContext,
        });
        if (remoteRequestIdRef.current !== requestId) return;
        setRemoteItems(Array.isArray(result?.items) ? result.items : []);
      } catch {
        if (remoteRequestIdRef.current === requestId) setRemoteItems([]);
      } finally {
        if (remoteRequestIdRef.current === requestId) setRemoteLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [canSearch, limit, query, remoteSearchContext, remoteSearchKey]);

  return (
    <div className={`search-picker${floating ? " is-floating" : ""}${className ? ` ${className}` : ""}`}>
      <div className={`search-picker-field${fieldClassName ? ` ${fieldClassName}` : ""}`}>
        <Search size={18} />
        <input
          value={value}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => {
            setExpanded(false);
            onChange(event.target.value);
          }}
        />
      </div>
      {canShow ? (
        <div
          className={`home-search-results unified search-picker-results${floating ? " is-floating" : ""}${resultsClassName ? ` ${resultsClassName}` : ""}`}
          onPointerDown={(event) => event.preventDefault()}
          onClickCapture={(event) => {
            if (!closeOnResultClick || event.target?.closest?.(".home-search-more")) return;
            window.setTimeout(closeResults, 0);
          }}
        >
          {resultTitle ? <strong className="search-picker-title">{resultTitle}</strong> : null}
          {visibleItems.length ? visibleItems.map(renderItem) : <div className="empty-state">{remoteLoading ? "검색 중..." : emptyText}</div>}
          {hasMore ? (
            <button type="button" className="home-search-more" onMouseDown={(event) => event.preventDefault()} onClick={() => setExpanded(true)}>
              더보기
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
