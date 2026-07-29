export function isWithinOneEdit(source = "", target = "") {
  if (source === target) return true;
  if (!source || !target || Math.abs(source.length - target.length) > 1) return false;

  let sourceIndex = 0;
  let targetIndex = 0;
  let edits = 0;
  while (sourceIndex < source.length && targetIndex < target.length) {
    if (source[sourceIndex] === target[targetIndex]) {
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (source.length > target.length) sourceIndex += 1;
    else if (target.length > source.length) targetIndex += 1;
    else {
      sourceIndex += 1;
      targetIndex += 1;
    }
  }
  return edits + Number(sourceIndex < source.length || targetIndex < target.length) <= 1;
}
