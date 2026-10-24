export function parseSingleRange(value, size) {
  if (value === undefined) return null;
  if (!value.startsWith("bytes=") || value.includes(",")) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || (match[1] === "" && match[2] === "")) return false;

  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
    if (start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
