import { Fragment } from "react";

export default function RoomPhaseRenderer({ viewModel, sections = {} }) {
  return (viewModel?.sectionOrder ?? []).map((sectionId) => {
    const renderSection = sections[sectionId];
    if (typeof renderSection !== "function") return null;
    return <Fragment key={sectionId}>{renderSection()}</Fragment>;
  });
}
