import { useCreateMatchBaseController } from "./useCreateMatchBaseController.js";
import { useCreateMatchValidationController } from "./useCreateMatchValidationController.js";
import { createCreateMatchActions } from "./CreateMatchActions.jsx";
import { CreateMatchLayout } from "./CreateMatchLayout.jsx";

export default function CreateMatchView(props) {
  const baseController = useCreateMatchBaseController(props);
  const validationController = useCreateMatchValidationController(baseController);
  const actions = createCreateMatchActions({
    ...baseController,
    ...validationController,
  });

  return (
    <CreateMatchLayout
      context={{
        ...baseController,
        ...validationController,
        ...actions,
      }}
    />
  );
}
