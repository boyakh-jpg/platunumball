import Badge from "../common/Badge.jsx";
import { getMemberRoleLabel } from "../../data/repository.js";

const roleTone = {
  captain: "gold",
  regular: "green",
  candidate: "blue",
  mercenary: "orange",
  guest: "neutral",
};

export default function MemberTypeBadge({ role }) {
  return <Badge tone={roleTone[role] ?? "neutral"}>{getMemberRoleLabel(role)}</Badge>;
}
