import { RecruitingRoomPrimarySection } from "./RecruitingRoomPrimarySection.jsx";
import { RecruitingRoomManagementSection } from "./RecruitingRoomManagementSection.jsx";
import { RecruitingRoomActionSection } from "./RecruitingRoomActionSection.jsx";
import { RecruitingRoomDialogSection } from "./RecruitingRoomDialogSection.jsx";

export function RecruitingRoomLayout({ context }) {
  const {
    cancelSheetDrag, closeFromBackdrop, finishSheetDrag, lobbyModalRef, moveSheetDrag, sheetBackdropOpacity,
    sheetDragOffset, sheetDragSettling, sheetModalOpacity, startSheetDrag,
  } = context;

  return (
<div
            className="arena-compose-backdrop arena-room-backdrop"
            role="presentation"
            style={{ "--sheet-backdrop-opacity": sheetBackdropOpacity }}
            onClick={closeFromBackdrop}
          >
            <aside
              ref={lobbyModalRef}
              className={`arena-lobby-modal ui-modal-shell ui-room-borderless-scope${sheetDragSettling ? " is-sheet-settling" : ""}${sheetDragOffset > 0 ? " is-sheet-dragging" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label="매치방"
              style={{ "--sheet-drag-y": `${sheetDragOffset}px`, "--sheet-modal-opacity": sheetModalOpacity }}
              onPointerDown={(event) => { event.stopPropagation(); startSheetDrag(event); }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onPointerMove={moveSheetDrag}
              onPointerUp={finishSheetDrag}
              onPointerCancel={cancelSheetDrag}
            >
              <button
                type="button"
                className="arena-lobby-drag-handle"
                aria-label="아래로 당겨 방 닫기"
                onClick={closeFromBackdrop}
              />
              <div className="arena-lobby-modal-scroll">
              <RecruitingRoomPrimarySection context={context} />

              <RecruitingRoomManagementSection context={context} />

              <RecruitingRoomActionSection context={context} />
              <RecruitingRoomDialogSection context={context} />
              </div>
            </aside>
          </div>
  );
}
