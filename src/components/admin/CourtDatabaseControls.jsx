import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, ScanLine } from "lucide-react";
import Button from "../common/Button.jsx";
import { getAdminCourtStreetViewUrl, getCourtCoordinate, getCourtMapUrl, getCourtNaverMapAppUrl } from "../../lib/courts.js";
import {
  MAP_WINDOW_NAME,
  STREET_VIEW_WINDOW_NAME,
  COURT_COLUMNS,
  SELECT_OPTIONS,
  FIELD_LABELS,
  formatValue,
  getMobileMapPlatform,
} from "./courtDatabaseModel.js";

export function SortIcon({ active, direction }) {
  if (!active) return <ArrowUpDown size={12} />;
  return direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

export function FilterControl({ column, value, onChange, onEnter }) {
  if (SELECT_OPTIONS[column.type]) {
    return (
      <select aria-label={`${column.label} 필터`} value={value} onChange={(event) => onChange(event.target.value)}>
        {SELECT_OPTIONS[column.type].map(([id, label]) => <option key={id || "all"} value={id}>{label}</option>)}
      </select>
    );
  }
  return (
    <input
      aria-label={`${column.label} 필터`}
      type={column.type === "date" ? "date" : "search"}
      value={value}
      placeholder={column.type === "date" ? "" : "필터"}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export function CellEditor({ column, value, disabled, onChange, onEscape }) {
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  if (column.editor === "select") {
    const options = (SELECT_OPTIONS[column.type] ?? [])
      .filter(([id]) => id !== "" && (column.nullable !== false || id !== "__null__"));
    const selected = value === null || value === undefined ? "__null__" : String(value);
    return (
      <select
        aria-label={`${column.label} 수정`}
        value={selected}
        autoFocus
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "__null__" ? null : column.type === "booleanNullable" ? next === "true" : next);
        }}
      >
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    );
  }
  return (
    <input
      aria-label={`${column.label} 수정`}
      type={column.editor === "number" ? "number" : column.editor === "url" ? "url" : column.editor === "tel" ? "tel" : "text"}
      value={value ?? ""}
      min={column.min}
      max={column.max}
      step={column.step ?? (column.editor === "number" ? 1 : undefined)}
      autoFocus
      disabled={disabled}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ReviewChipGroup({ group, value, dirty, disabled, onChange }) {
  return (
    <fieldset className={`court-db-review-chip-group ${dirty ? "is-dirty" : ""}`}>
      <legend>{group.label}</legend>
      <div>
        {group.options.map(([optionValue, label]) => {
          const selected = Object.is(value ?? null, optionValue ?? null);
          return (
            <button
              key={`${group.key}-${String(optionValue)}`}
              type="button"
              className={selected ? "selected" : ""}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(group.key, optionValue)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CourtMapLinks({ court, evidenceUrl = "" }) {
  const mobilePlatform = getMobileMapPlatform();
  const mapUrl = mobilePlatform ? getCourtNaverMapAppUrl(court, mobilePlatform) : getCourtMapUrl(court);
  const mapTarget = mobilePlatform ? undefined : MAP_WINDOW_NAME;
  const hasCoordinates = Boolean(getCourtCoordinate(court));
  return (
    <>
      <a href={mapUrl} target={mapTarget} title={mobilePlatform ? "네이버지도 앱에서 열기" : "네이버지도 웹에서 열기"}>
        <ExternalLink size={14} /> {mobilePlatform ? "네이버지도 앱" : "네이버지도"}
      </a>
      {hasCoordinates ? (
        <a href={getAdminCourtStreetViewUrl(court)} target={STREET_VIEW_WINDOW_NAME} title="가장 가까운 네이버 거리뷰 열기">
          <ScanLine size={14} /> 거리뷰
        </a>
      ) : null}
      {evidenceUrl ? <a href={String(evidenceUrl)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> OSM 근거</a> : null}
    </>
  );
}

export function Pagination({ page, onChange, loading }) {
  const current = Number(page?.page ?? 1);
  const pageCount = Number(page?.pageCount ?? 1);
  return (
    <div className="court-db-pagination">
      <span>전체 {Number(page?.total ?? 0).toLocaleString()}개 · {current}/{pageCount}페이지 · 100행</span>
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={loading || current <= 1} onClick={() => onChange(current - 1)}>이전</Button>
        <Button type="button" size="sm" variant="secondary" disabled={loading || current >= pageCount} onClick={() => onChange(current + 1)}>다음</Button>
      </div>
    </div>
  );
}

export function ChangeSummary({ changes }) {
  const entries = changes && typeof changes === "object" && !Array.isArray(changes) ? Object.entries(changes) : [];
  if (!entries.length) return <span>-</span>;
  return (
    <div className="court-db-history-changes">
      {entries.map(([key, change]) => (
        <span key={key}>
          <b>{FIELD_LABELS[key] ?? key}</b>{" "}
          {formatValue(COURT_COLUMNS.find((column) => (column.patchKey || column.key) === key) ?? {}, change?.before)} → {formatValue(COURT_COLUMNS.find((column) => (column.patchKey || column.key) === key) ?? {}, change?.after)}
        </span>
      ))}
    </div>
  );
}
