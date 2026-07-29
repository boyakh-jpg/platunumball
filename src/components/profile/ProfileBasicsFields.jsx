import { BASKETBALL_POSITIONS } from "../../lib/constants.js";
import { REGION_TREE, getRegionDistrictOptions } from "../../lib/profileSetup.js";

export default function ProfileBasicsFields({
  position,
  regionSido,
  regionDistrict,
  onPositionChange,
  onRegionChange,
}) {
  const districtOptions = getRegionDistrictOptions(regionSido);
  const district = districtOptions.includes(regionDistrict) ? regionDistrict : districtOptions[0] ?? "";

  return (
    <>
      <label>
        주 포지션
        <select value={position} onChange={(event) => onPositionChange(event.target.value)}>
          {BASKETBALL_POSITIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>
        시도
        <select
          value={regionSido}
          onChange={(event) => {
            const nextSido = event.target.value;
            onRegionChange(nextSido, getRegionDistrictOptions(nextSido)[0] ?? "");
          }}
        >
          {REGION_TREE.map((region) => <option key={region.sido} value={region.sido}>{region.sido}</option>)}
        </select>
      </label>
      <label>
        시군구
        <select value={district} onChange={(event) => onRegionChange(regionSido, event.target.value)}>
          {districtOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </>
  );
}
