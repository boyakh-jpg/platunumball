import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


MODULE_PATH = Path(__file__).with_name("infer-osm-court-names.py")
SPEC = importlib.util.spec_from_file_location("osm_court_name_inference", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def candidate(name, kind, distance=0, area=1, level=0):
    return {
        "name": name,
        "kind": kind,
        "distanceMeters": distance,
        "area": area,
        "adminLevel": level,
        "osmType": "way",
        "osmId": 1,
    }


class CandidatePolicyTest(unittest.TestCase):
    def test_containment_precedes_category_in_required_order(self):
        selected = MODULE.best_containment([
            candidate("한빛공원", "park_ground", area=0.2),
            candidate("서울시민체육관", "sports_centre", area=2),
            candidate("한빛초등학교", "school", area=1),
            candidate("한빛관", "building", area=0.1),
        ])
        self.assertEqual(selected["name"], "서울시민체육관")

    def test_nearby_uses_distance_before_category(self):
        selected = MODULE.best_nearby([
            candidate("먼체육관", "sports_centre", distance=29),
            candidate("가까운건물", "building", distance=4),
        ])
        self.assertEqual(selected["name"], "가까운건물")

    def test_nearby_over_80_is_rejected(self):
        self.assertIsNone(MODULE.best_nearby([candidate("먼건물", "building", distance=80.1)]))

    def test_generic_osm_name_detection(self):
        self.assertTrue(MODULE.is_generic_source_name("이름 없는 농구장 (node/123)"))
        self.assertTrue(MODULE.is_generic_source_name("Basketball Court"))
        self.assertFalse(MODULE.is_generic_source_name("한빛공원 농구장"))

    def test_reference_name_format(self):
        self.assertEqual(MODULE.reference_facility_name("한빛공원", nearby=True), "한빛공원 근처")
        self.assertEqual(MODULE.reference_facility_name("서울시민체육관 농구장"), "서울시민체육관")
        self.assertEqual(MODULE.reference_facility_name("제주학교(중.고등학교)", nearby=True), "제주학교(중.고등학교) 근처")

    def test_generic_building_labels_are_not_names(self):
        self.assertEqual(MODULE.useful_name({"name": "101"}), "")
        self.assertEqual(MODULE.useful_name({"name": "상가동"}), "")
        self.assertEqual(MODULE.useful_name({"name": "검단복지회관"}), "검단복지회관")

    def test_admin_fallback_prefers_smallest_highest_level(self):
        selected = MODULE.best_administrative([
            candidate("서울특별시", "administrative", area=20, level=4),
            candidate("성동구", "administrative", area=5, level=8),
            candidate("성수1가1동", "administrative", area=1, level=10),
        ], "성동구")
        self.assertEqual(selected["name"], "성수1가1동")

    def test_stored_dong_is_last_fallback_only(self):
        empty_handler = SimpleNamespace(self_candidates={}, inside={}, site_members={}, nearby={})
        proposal = MODULE.build_proposal({
            "id": "court_test",
            "sigungu": "성동구",
            "emd": "성수1가1동",
            "currentName": "잘못된 원거리 이름",
            "currentFacilityName": "잘못된 원거리 이름",
            "sourceCourtUrl": "https://www.openstreetmap.org/way/1",
        }, empty_handler, 0, "run", "2026-07-20")
        self.assertEqual(proposal["decision"], "administrative_fallback")
        self.assertEqual(proposal["referenceKind"], "stored_administrative")
        self.assertEqual(proposal["appliedFacilityName"], "성수1가1동")

    def test_30_to_80_meter_candidate_is_review_only(self):
        handler = SimpleNamespace(
            self_candidates={},
            inside={},
            site_members={},
            nearby={0: [candidate("한빛공원", "park_ground", distance=42)]},
        )
        proposal = MODULE.build_proposal({
            "id": "court_review",
            "sigungu": "성동구",
            "emd": "성수1가1동",
            "currentName": "성동구 성수1가1동 농구장",
            "currentFacilityName": "성수1가1동",
            "sourceCourtUrl": "https://www.openstreetmap.org/way/2",
        }, handler, 0, "run", "2026-07-20")
        self.assertEqual(proposal["decision"], "review_required")
        self.assertEqual(proposal["proposedFacilityName"], "한빛공원 근처")
        self.assertEqual(proposal["appliedFacilityName"], "성수1가1동")


if __name__ == "__main__":
    unittest.main()
