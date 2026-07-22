#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import osmium
    import requests
    from shapely import wkb
    from shapely.geometry import Point
    from shapely.ops import nearest_points
except ImportError as error:
    raise SystemExit(f"missing_dependency:{error.name}") from error


INFERENCE_VERSION = "osm-spatial-v2"
CELL_DEGREES = 0.02
AUTO_NEARBY_METERS = 30.0
REVIEW_NEARBY_METERS = 80.0
HANGUL_RE = re.compile(r"[가-힣]")
OSM_SOURCE_RE = re.compile(r"^osm:(node|way|relation):(\d+)$", re.IGNORECASE)
GENERIC_NAME_RE = re.compile(
    r"^(?:(?:이름\s*없는\s*)?(?:실내|실외|야외)?\s*농구(?:장|\s*코트|골대)"
    r"(?:\s*[A-Z0-9]+)?(?:\s*\((?:node|way|relation)?/?\d+\))?|"
    r"basketball(?:\s+court)?(?:\s*[A-Z0-9]+)?)$",
    re.IGNORECASE,
)
UNSTABLE_NAME_RE = re.compile(
    r"(?:공개\s*공지|뒤쪽|앞쪽|예정|임시|공사\s*중)|"
    r"^(?:본관|별관|생활관|연구동|식당|급식실|주차장|체육관|운동장|대운동장|"
    r"기숙사|숙소|사택|관사|상가|상가동|관리사무소|경비실|주민복지관|"
    r"쉼터|그늘\s*쉼터|온실|창고|\d{1,4}(?:동)?|[A-Z]\d+|factory)$",
    re.IGNORECASE,
)
SCHOOL_NAME_RE = re.compile(
    r"^(.+?(?:초등학교|중학교|고등학교|대학교|학교|유치원))"
    r"(?:\s+(?:급식실|체육관|본관|별관|운동장))$"
)

CONTAINMENT_PRIORITY = {
    "sports_centre": 0,
    "school": 10,
    "building": 20,
    "park_ground": 30,
    "community_centre": 40,
    "landmark": 50,
}
MEMBER_TYPES = {"n": "node", "w": "way", "r": "relation"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--snapshot-date", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch-size", type=int, default=100)
    return parser.parse_args()


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_identity(value: Any) -> str:
    return re.sub(r"[\W_]+", "", clean_text(value).lower(), flags=re.UNICODE)


def useful_name(tags: Any) -> str:
    candidates = [
        tags.get("name:ko"),
        tags.get("official_name:ko"),
        tags.get("name"),
        tags.get("official_name"),
    ]
    fallback = ""
    for value in candidates:
        name = clean_text(value)
        school_match = SCHOOL_NAME_RE.match(name)
        if school_match:
            name = school_match.group(1)
        if not name or GENERIC_NAME_RE.fullmatch(name) or UNSTABLE_NAME_RE.search(name):
            continue
        if HANGUL_RE.search(name):
            return name
        if not fallback:
            fallback = name
    return fallback


def is_generic_source_name(value: Any) -> bool:
    name = clean_text(value)
    return not name or bool(GENERIC_NAME_RE.fullmatch(name)) or bool(
        re.match(r"^이름\s*없는\s*농구장\s*\((?:node|way|relation)/\d+\)$", name, re.IGNORECASE)
    )


def source_original_name(source: dict[str, Any]) -> str:
    payload = source.get("raw_payload") or {}
    return clean_text(
        payload.get("구장명")
        or payload.get("name")
        or payload.get("facilityName")
        or payload.get("시설명")
    )


def classify(tags: dict[str, str]) -> str | None:
    leisure = clean_text(tags.get("leisure")).lower()
    sport = clean_text(tags.get("sport")).lower()
    amenity = clean_text(tags.get("amenity")).lower()
    building = clean_text(tags.get("building")).lower()
    landuse = clean_text(tags.get("landuse")).lower()
    boundary = clean_text(tags.get("boundary")).lower()
    office = clean_text(tags.get("office")).lower()
    shop = clean_text(tags.get("shop")).lower()
    tourism = clean_text(tags.get("tourism")).lower()

    if "basketball" in {item.strip() for item in sport.split(";") if item.strip()}:
        return "exact_court"
    if boundary == "administrative":
        try:
            return "administrative" if int(tags.get("admin_level", "0")) >= 8 else None
        except ValueError:
            return None
    if leisure in {"sports_centre", "stadium", "fitness_centre"} or building in {"sports_hall", "stadium"}:
        return "sports_centre"
    if amenity in {"school", "college", "university", "kindergarten"}:
        return "school"
    if building in {"school", "college", "university", "kindergarten"} or landuse == "education":
        return "school"
    if building and building not in {"no", "roof", "shed", "garage", "garages"}:
        return "building"
    if landuse == "residential":
        return "building"
    if leisure in {"park", "garden", "nature_reserve"} or landuse == "recreation_ground":
        return "park_ground"
    if amenity in {
        "community_centre", "townhall", "public_building", "library", "hospital", "clinic",
        "police", "fire_station", "place_of_worship", "social_facility",
    }:
        return "community_centre"
    if office or shop in {"mall", "department_store", "supermarket"} or tourism:
        return "landmark"
    return None


def reference_facility_name(value: Any, nearby: bool = False) -> str:
    name = clean_text(value)
    name = re.sub(r"\s*(?:실내|실외|야외)?\s*농구\s*코트\s*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*(?:실내|실외|야외)?\s*농구장\s*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[\s·,\-]+$", "", name).strip()
    if nearby and name and not name.endswith("근처"):
        name = f"{name} 근처"
    return name


def cell_key(lng: float, lat: float) -> tuple[int, int]:
    return math.floor(lng / CELL_DEGREES), math.floor(lat / CELL_DEGREES)


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371008.8
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def osm_url(osm_type: str, osm_id: int) -> str:
    return f"https://www.openstreetmap.org/{osm_type}/{osm_id}"


def parse_osm_ref(value: Any) -> tuple[str, int] | None:
    match = OSM_SOURCE_RE.fullmatch(clean_text(value))
    return (match.group(1).lower(), int(match.group(2))) if match else None


def load_env_file(path: str) -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def supabase_config() -> tuple[str, str]:
    url = clean_text(
        os.environ.get("SUPABASE_URL")
        or os.environ.get("VITE_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    ).rstrip("/")
    key = clean_text(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    if not url or not key:
        raise RuntimeError("supabase_config_missing")
    return url, key


def fetch_all(url: str, key: str, table: str, select: str) -> list[dict[str, Any]]:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = requests.get(
            f"{url}/rest/v1/{table}",
            headers=headers,
            params={"select": select, "limit": "1000", "offset": str(offset)},
            timeout=60,
        )
        if not response.ok:
            raise RuntimeError(f"supabase_read_failed:{table}:{response.status_code}:{response.text[:300]}")
        page = response.json()
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += len(page)


def load_targets(url: str, key: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    court_rows = fetch_all(
        url,
        key,
        "approved_courts",
        "id,name,facility_name,court_unit,sigungu,emd,lat,lng,name_modification_count,name_source,status",
    )
    source_rows = fetch_all(
        url,
        key,
        "court_source_records",
        "court_id,provider,source_record_id,source_url,raw_payload",
    )
    sources_by_court: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source in source_rows:
        sources_by_court[clean_text(source.get("court_id"))].append(source)

    stats = Counter()
    targets: list[dict[str, Any]] = []
    for court in court_rows:
        court_id = clean_text(court.get("id"))
        sources = sources_by_court.get(court_id, [])
        osm_sources = [source for source in sources if source.get("provider") == "openstreetmap"]
        if not osm_sources:
            continue
        stats["osmCourts"] += 1
        if any(source.get("provider") != "openstreetmap" for source in sources):
            stats["preservedMultiSource"] += 1
            continue
        if any(not is_generic_source_name(source_original_name(source)) for source in osm_sources):
            stats["preservedNamedSource"] += 1
            continue
        if int(court.get("name_modification_count") or 0) > 0 or court.get("name_source") == "manual":
            stats["preservedManual"] += 1
            continue
        refs = {parsed for source in osm_sources if (parsed := parse_osm_ref(source.get("source_record_id")))}
        if not refs:
            stats["invalidSourceRef"] += 1
            continue
        try:
            lat = float(court["lat"])
            lng = float(court["lng"])
        except (KeyError, TypeError, ValueError):
            stats["invalidCoordinate"] += 1
            continue
        if not (32 <= lat <= 39.6 and 123 <= lng <= 133):
            stats["invalidCoordinate"] += 1
            continue
        targets.append({
            "id": court_id,
            "lat": lat,
            "lng": lng,
            "point": Point(lng, lat),
            "sourceRefs": refs,
            "sourceCourtUrl": osm_url(*sorted(refs)[0]),
            "currentName": clean_text(court.get("name")),
            "currentFacilityName": clean_text(court.get("facility_name")),
            "sigungu": clean_text(court.get("sigungu")),
            "emd": clean_text(court.get("emd")),
        })
    stats["repairTargets"] = len(targets)
    return targets, dict(sorted(stats.items()))


class SpatialNameHandler(osmium.SimpleHandler):
    def __init__(self, targets: list[dict[str, Any]]) -> None:
        super().__init__()
        self.factory = osmium.geom.WKBFactory()
        self.targets = targets
        self.target_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.target_by_ref: dict[tuple[str, int], list[int]] = defaultdict(list)
        for index, target in enumerate(targets):
            self.target_grid[cell_key(target["lng"], target["lat"])].append(index)
            for source_ref in target["sourceRefs"]:
                self.target_by_ref[source_ref].append(index)
        self.self_candidates: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.inside: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.site_members: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.nearby: dict[int, list[dict[str, Any]]] = defaultdict(list)
        self.stats = Counter()

    def nearby_target_indexes(self, min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> set[int]:
        padding = REVIEW_NEARBY_METERS / 90000.0
        min_x, min_y = cell_key(min_lng - padding, min_lat - padding)
        max_x, max_y = cell_key(max_lng + padding, max_lat + padding)
        if (max_x - min_x + 1) * (max_y - min_y + 1) > 2500:
            return set()
        indexes: set[int] = set()
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                indexes.update(self.target_grid.get((x, y), ()))
        return indexes

    @staticmethod
    def candidate(name: str, kind: str, osm_type: str, osm_id: int, distance: float, **extra: Any) -> dict[str, Any]:
        return {
            "name": name,
            "kind": kind,
            "osmType": osm_type,
            "osmId": osm_id,
            "distanceMeters": round(distance, 1),
            **extra,
        }

    def add_self(self, source_ref: tuple[str, int], name: str, kind: str | None) -> None:
        if not name:
            return
        for index in self.target_by_ref.get(source_ref, ()):
            self.self_candidates[index].append(self.candidate(name, kind or "exact_court", *source_ref, 0.0))

    def add_point_candidate(self, osm_type: str, osm_id: int, lng: float, lat: float, tags: dict[str, str]) -> None:
        name = useful_name(tags)
        kind = classify(tags)
        self.add_self((osm_type, osm_id), name, kind)
        if not name or kind in {None, "exact_court", "administrative"}:
            return
        for index in self.nearby_target_indexes(lng, lat, lng, lat):
            target = self.targets[index]
            distance = haversine_meters(target["lat"], target["lng"], lat, lng)
            if distance <= REVIEW_NEARBY_METERS:
                self.nearby[index].append(self.candidate(name, kind, osm_type, osm_id, distance))

    def node(self, node: Any) -> None:
        self.add_point_candidate("node", int(node.id), node.location.lon, node.location.lat, dict(node.tags))
        self.stats["namedNodes"] += 1

    def way(self, way: Any) -> None:
        tags = dict(way.tags)
        name = useful_name(tags)
        kind = classify(tags)
        self.add_self(("way", int(way.id)), name, kind)
        if not name or kind in {None, "exact_court", "administrative"}:
            return
        locations = [(node.lon, node.lat) for node in way.nodes if node.location.valid()]
        if not locations:
            return
        lng = sum(item[0] for item in locations) / len(locations)
        lat = sum(item[1] for item in locations) / len(locations)
        self.add_point_candidate("way", int(way.id), lng, lat, tags)
        self.stats["namedWays"] += 1

    def relation(self, relation: Any) -> None:
        tags = dict(relation.tags)
        name = useful_name(tags)
        kind = classify(tags)
        relation_id = int(relation.id)
        self.add_self(("relation", relation_id), name, kind)
        if not name or clean_text(tags.get("type")).lower() != "site":
            return
        site_kind = kind or "landmark"
        base = self.candidate(name, site_kind, "relation", relation_id, 0.0)
        for member in relation.members:
            member_type = MEMBER_TYPES.get(str(member.type).lower())
            if not member_type:
                continue
            for index in self.target_by_ref.get((member_type, int(member.ref)), ()):
                self.site_members[index].append(base)
        self.stats["namedSiteRelations"] += 1

    def area(self, area: Any) -> None:
        tags = dict(area.tags)
        name = useful_name(tags)
        kind = classify(tags)
        if not name or kind is None:
            return
        osm_type = "way" if area.from_way() else "relation"
        osm_id = int(area.orig_id())
        self.add_self((osm_type, osm_id), name, kind)
        if kind == "exact_court":
            return
        try:
            raw_geometry = self.factory.create_multipolygon(area)
            geometry = wkb.loads(raw_geometry, hex=isinstance(raw_geometry, str))
        except Exception:
            self.stats["invalidAreas"] += 1
            return
        if geometry.is_empty:
            return
        min_lng, min_lat, max_lng, max_lat = geometry.bounds
        indexes = self.nearby_target_indexes(min_lng, min_lat, max_lng, max_lat)
        for index in indexes:
            target = self.targets[index]
            base = {
                "name": name,
                "kind": kind,
                "osmType": osm_type,
                "osmId": osm_id,
                "area": float(geometry.area),
                "adminLevel": int(tags.get("admin_level", "0")) if str(tags.get("admin_level", "")).isdigit() else 0,
            }
            if geometry.covers(target["point"]):
                self.inside[index].append({**base, "distanceMeters": 0.0})
                continue
            if kind == "administrative":
                continue
            try:
                closest = nearest_points(target["point"], geometry)[1]
                distance = haversine_meters(target["lat"], target["lng"], closest.y, closest.x)
            except Exception:
                continue
            if distance <= REVIEW_NEARBY_METERS:
                self.nearby[index].append({**base, "distanceMeters": round(distance, 1)})
        self.stats["namedAreas"] += 1


def best_self(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    return min(candidates, key=lambda item: (0 if HANGUL_RE.search(item["name"]) else 1, item["name"])) if candidates else None


def best_containment(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    usable = [item for item in candidates if item["kind"] not in {"administrative", "exact_court"}]
    return min(
        usable,
        key=lambda item: (CONTAINMENT_PRIORITY.get(item["kind"], 999), item.get("area", float("inf")), item["name"]),
    ) if usable else None


def best_nearby(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    usable = [item for item in candidates if item["kind"] not in {"administrative", "exact_court"} and item["distanceMeters"] <= REVIEW_NEARBY_METERS]
    return min(
        usable,
        key=lambda item: (item["distanceMeters"], CONTAINMENT_PRIORITY.get(item["kind"], 999), item.get("area", float("inf")), item["name"]),
    ) if usable else None


def best_administrative(candidates: list[dict[str, Any]], sigungu: str = "") -> dict[str, Any] | None:
    usable = [
        item for item in candidates
        if item["kind"] == "administrative"
        and normalize_identity(item["name"]) != normalize_identity(sigungu)
    ]
    return min(
        usable,
        key=lambda item: (-item.get("adminLevel", 0), item.get("area", float("inf")), item["name"]),
    ) if usable else None


def confidence_for(relation: str, distance: float = 0.0) -> float:
    if relation == "self":
        return 0.99
    if relation == "inside":
        return 0.96
    if relation == "site_member":
        return 0.93
    if relation == "nearby":
        return round(max(0.60, 0.90 - distance / 250), 2)
    if relation == "administrative":
        return 0.55
    return 0.0


def build_proposal(target: dict[str, Any], handler: SpatialNameHandler, index: int, run_id: str, snapshot_date: str) -> dict[str, Any]:
    admin = best_administrative(handler.inside.get(index, []), target.get("sigungu", ""))
    stored_admin_name = clean_text(target.get("emd"))
    if normalize_identity(stored_admin_name) == normalize_identity(target.get("sigungu")):
        stored_admin_name = ""
    candidate = best_self(handler.self_candidates.get(index, []))
    relation = "self"
    if candidate is None:
        candidate = best_containment(handler.inside.get(index, []))
        relation = "inside"
    if candidate is None:
        candidate = best_containment(handler.site_members.get(index, []))
        relation = "site_member"
    if candidate is None:
        candidate = best_nearby(handler.nearby.get(index, []))
        relation = "nearby"

    decision = "unresolved"
    proposed_facility_name = None
    applied_facility_name = None
    reference_name = None
    reference_kind = None
    distance = None
    evidence_url = None
    fallback_reference_name = None
    fallback_evidence_url = None
    confidence = 0.0

    if candidate is not None:
        reference_name = candidate["name"]
        reference_kind = candidate["kind"]
        distance = float(candidate.get("distanceMeters", 0.0))
        evidence_url = osm_url(candidate["osmType"], candidate["osmId"])
        proposed_facility_name = reference_facility_name(reference_name, nearby=relation == "nearby") or None
        confidence = confidence_for(relation, distance)
        if relation != "nearby" or distance <= AUTO_NEARBY_METERS:
            decision = "auto_apply"
            applied_facility_name = proposed_facility_name
        else:
            decision = "review_required"
            if admin is not None:
                fallback_reference_name = admin["name"]
                fallback_evidence_url = osm_url(admin["osmType"], admin["osmId"])
                applied_facility_name = reference_facility_name(admin["name"]) or None
            elif stored_admin_name:
                fallback_reference_name = stored_admin_name
                applied_facility_name = reference_facility_name(stored_admin_name) or None
    elif admin is not None:
        decision = "administrative_fallback"
        relation = "administrative"
        reference_name = admin["name"]
        reference_kind = admin["kind"]
        distance = 0.0
        evidence_url = osm_url(admin["osmType"], admin["osmId"])
        proposed_facility_name = reference_facility_name(admin["name"]) or None
        applied_facility_name = proposed_facility_name
        confidence = confidence_for(relation)
    elif stored_admin_name:
        decision = "administrative_fallback"
        relation = "administrative"
        reference_name = stored_admin_name
        reference_kind = "stored_administrative"
        distance = 0.0
        proposed_facility_name = reference_facility_name(stored_admin_name) or None
        applied_facility_name = proposed_facility_name
        confidence = 0.45
    else:
        relation = "none"

    if applied_facility_name and normalize_identity(applied_facility_name) == normalize_identity(target.get("sigungu")):
        applied_facility_name = None
        decision = "unresolved"

    return {
        "courtId": target["id"],
        "currentName": target.get("currentName"),
        "currentFacilityName": target.get("currentFacilityName"),
        "decision": decision,
        "relation": relation,
        "referenceName": reference_name,
        "referenceKind": reference_kind,
        "distanceMeters": distance,
        "confidence": confidence,
        "evidenceUrl": evidence_url,
        "fallbackReferenceName": fallback_reference_name,
        "fallbackEvidenceUrl": fallback_evidence_url,
        "proposedFacilityName": proposed_facility_name,
        "appliedFacilityName": applied_facility_name,
        "sourceCourtUrl": target.get("sourceCourtUrl"),
        "sourceSnapshotDate": snapshot_date,
        "inferenceVersion": INFERENCE_VERSION,
        "runId": run_id,
    }


def rpc_row(proposal: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "courtId", "decision", "relation", "referenceName", "referenceKind", "distanceMeters",
        "confidence", "evidenceUrl", "fallbackReferenceName", "fallbackEvidenceUrl",
        "proposedFacilityName", "appliedFacilityName", "sourceCourtUrl", "sourceSnapshotDate",
        "inferenceVersion", "runId",
    }
    return {key: value for key, value in proposal.items() if key in allowed}


def apply_proposals(url: str, key: str, proposals: list[dict[str, Any]], run_id: str, batch_size: int) -> dict[str, int]:
    if batch_size < 1 or batch_size > 100:
        raise RuntimeError("batch_size_must_be_1_to_100")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    summary = Counter()
    for offset in range(0, len(proposals), batch_size):
        batch = [rpc_row(item) for item in proposals[offset:offset + batch_size]]
        response = requests.post(
            f"{url}/rest/v1/rpc/rankball_apply_osm_court_name_evidence",
            headers=headers,
            json={"p_rows": batch, "p_apply": True, "p_run_id": run_id},
            timeout=120,
        )
        if not response.ok:
            raise RuntimeError(f"supabase_apply_failed:{offset}:{response.status_code}:{response.text[:500]}")
        result = response.json() or {}
        for field in ("evidenceCount", "appliedCount", "unchangedCount", "skippedCount", "duplicateCount"):
            summary[field] += int(result.get(field) or 0)
    return dict(sorted(summary.items()))


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    url, key = supabase_config()
    targets, target_stats = load_targets(url, key)
    handler = SpatialNameHandler(targets)
    filters = [osmium.filter.KeyFilter("name", "name:ko", "official_name", "official_name:ko")]
    handler.apply_file(args.pbf, locations=True, idx="sparse_mem_array", filters=filters)

    generated_at = datetime.now(timezone.utc).isoformat()
    run_seed = f"{INFERENCE_VERSION}|{args.snapshot_date}|{generated_at}"
    run_id = f"osm_name_{hashlib.sha256(run_seed.encode('utf-8')).hexdigest()[:20]}"
    proposals = [build_proposal(target, handler, index, run_id, args.snapshot_date) for index, target in enumerate(targets)]
    result_counts = Counter()
    for item in proposals:
        result_counts[f"decision:{item['decision']}"] += 1
        result_counts[f"relation:{item['relation']}"] += 1
        if item["referenceKind"]:
            result_counts[f"kind:{item['referenceKind']}"] += 1
        if item["appliedFacilityName"]:
            result_counts["hasAppliedFacilityName"] += 1

    document = {
        "schemaVersion": 1,
        "generator": INFERENCE_VERSION,
        "runId": run_id,
        "generatedAt": generated_at,
        "sourceSnapshotDate": args.snapshot_date,
        "summary": {
            "targets": target_stats,
            "handler": dict(sorted(handler.stats.items())),
            "results": dict(sorted(result_counts.items())),
        },
        "proposals": proposals,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.apply:
        document["applySummary"] = apply_proposals(url, key, proposals, run_id, args.batch_size)
        output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**document["summary"], "apply": document.get("applySummary")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
