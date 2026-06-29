import Badge from "../common/Badge.jsx";
import { getMemberRoleLabel } from "../../data/repository.js";
import { normalizeTeamRole } from "../../lib/constants.js";

const roleTone = {
  captain: "gold",
  regular: "green",
  mercenary: "orange",
};

export default function MemberTypeBadge({ role }) {
  const canonicalRole = normalizeTeamRole(role);
  return <Badge tone={roleTone[canonicalRole] ?? "neutral"}>{getMemberRoleLabel(canonicalRole)}</Badge>;
}
