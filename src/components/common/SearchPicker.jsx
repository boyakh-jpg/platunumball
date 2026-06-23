import { useState } from "react";
import { Search } from "lucide-react";

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
  limit = 6,
  detailLimit = 24,
  showIdleOnFocus = false,
  floating = false,
  className = "",
  fieldClassName = "",
  resultsClassName = "",
}) {
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const query = value.trim();
  const activeItems = query ? items : idleItems;
  const canShow = floating
    ? focused && (query || showIdleOnFocus)
    : query || (showIdleOnFocus && focused);
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
