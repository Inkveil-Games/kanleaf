export function graphRows(tops: number[], height: number, minimumGap: number) {
  const ranks = [...new Set(tops)].sort((left, right) => left - right);
  const origin = ranks[0] ?? 0;
  const step = Math.max(
    height + minimumGap,
    ...ranks.slice(1).map((top, index) => top - (ranks[index] ?? top)),
  );
  return {
    step,
    mapY(value: number) {
      if (!ranks.length || value <= origin) return value;
      let index = 0;
      while (
        index + 1 < ranks.length &&
        (ranks[index + 1] ?? Infinity) <= value
      )
        index += 1;
      const top = ranks[index] ?? origin;
      const next = ranks[index + 1];
      const offset = value - top;
      const mappedTop = origin + index * step;
      if (offset <= height || next === undefined) return mappedTop + offset;
      return (
        mappedTop +
        height +
        ((offset - height) / (next - top - height)) * (step - height)
      );
    },
  };
}
