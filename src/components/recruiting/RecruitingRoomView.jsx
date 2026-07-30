import { buildRecruitingRoomPolicyModel } from "./RecruitingRoomPolicyModel.jsx";
import { buildRecruitingRoomMatchModel } from "./RecruitingRoomMatchModel.jsx";
import { createRecruitingRoomMatchRenderers } from "./RecruitingRoomMatchRenderers.jsx";
import { createRecruitingRoomSlotRenderers } from "./RecruitingRoomSlotRenderers.jsx";
import { RecruitingRoomLayout } from "./RecruitingRoomLayout.jsx";

export function RecruitingRoomView({ context }) {
  const policyModel = buildRecruitingRoomPolicyModel(context);
  const matchModel = buildRecruitingRoomMatchModel({
    ...context,
    ...policyModel,
  });
  const matchRenderers = createRecruitingRoomMatchRenderers({
    ...context,
    ...policyModel,
    ...matchModel,
  });
  const slotRenderers = createRecruitingRoomSlotRenderers({
    ...context,
    ...policyModel,
    ...matchModel,
    ...matchRenderers,
  });

  return (
    <RecruitingRoomLayout
      context={{
        ...context,
        ...policyModel,
        ...matchModel,
        ...matchRenderers,
        ...slotRenderers,
      }}
    />
  );
}
