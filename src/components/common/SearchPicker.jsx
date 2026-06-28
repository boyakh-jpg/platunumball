import { useMemo, useState } from "react";
import { Search } from "lucide-react";

function normalizeSearchText(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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
  showIdleOnFocus = false,
  floating = false,
  className = "",
  fieldClassName = "",
  resultsClassName = "",
}) {
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const query = value.trim();
  const canSearch = normalizeSearchText(query).length >= minSearchLength;
  const activeItems = useMemo(() => {
    if (!canSearch) return idleItems;
    return (items ?? [])
      .map((item, index) => ({
        item,
        index,
        score: getSearchScore(getSearchText(item), query),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.item);
  }, [canSearch, getSearchText, idleItems, items, query]);
  const canShow = floating
    ? focused && (canSearch || showIdleOnFocus)
    : canSearch || (showIdleOnFocus && focused);
  const visibleItems = activeItems.slice(0, expanded ? detailLimit : limit);
  const hasMore = activeItems.length > limit && !expanded;
  const resultTitle = query ? title : idleTitle;

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
        <div className={`home-search-results unified search-picker-results${floating ? " is-floating" : ""}${resultsClassName ? ` ${resultsClassName}` : ""}`}>
          {resultTitle ? <strong className="search-picker-title">{resultTitle}</strong> : null}
          {visibleItems.length ? visibleItems.map(renderItem) : <div className="empty-state">{emptyText}</div>}
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
