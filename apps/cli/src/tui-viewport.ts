export type ChoiceViewport = {
  start: number;
  end: number;
  hiddenBefore: number;
  hiddenAfter: number;
};

function hardWrapWord(word: string, width: number): string[] {
  if (word.length <= width) return [word];
  const chunks: string[] = [];
  for (let offset = 0; offset < word.length; offset += width) chunks.push(word.slice(offset, offset + width));
  return chunks;
}

function wrapParagraph(paragraph: string, width: number): string[] {
  if (!paragraph) return [""];
  const words = paragraph.trim().split(/\s+/).flatMap((word) => hardWrapWord(word, width));
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

export function wrapChoiceText(text: string, maxWidth: number): string[] {
  const width = Math.max(1, Math.floor(maxWidth));
  return text.split("\n").flatMap((paragraph) => wrapParagraph(paragraph, width));
}

export function resolveChoiceViewport(
  renderedOptions: readonly string[][],
  cursorValue: number,
  maxRowsValue: number,
): ChoiceViewport {
  if (!renderedOptions.length) return { start: 0, end: -1, hiddenBefore: 0, hiddenAfter: 0 };
  const cursor = Math.min(Math.max(0, cursorValue), renderedOptions.length - 1);
  const maxRows = Math.max(1, Math.floor(maxRowsValue));
  let best: ChoiceViewport = {
    start: cursor,
    end: cursor,
    hiddenBefore: cursor,
    hiddenAfter: renderedOptions.length - cursor - 1,
  };
  let bestCount = 1;
  let bestRows = renderedOptions[cursor]!.length + (best.hiddenBefore ? 1 : 0) + (best.hiddenAfter ? 1 : 0);
  let bestBalance = Math.abs(best.hiddenBefore - best.hiddenAfter);

  for (let start = 0; start <= cursor; start += 1) {
    let optionRows = 0;
    for (let end = start; end < renderedOptions.length; end += 1) {
      optionRows += renderedOptions[end]!.length;
      if (end < cursor) continue;
      const hiddenBefore = start;
      const hiddenAfter = renderedOptions.length - end - 1;
      const rows = optionRows + (hiddenBefore ? 1 : 0) + (hiddenAfter ? 1 : 0);
      if (rows > maxRows) continue;
      const count = end - start + 1;
      const balance = Math.abs((cursor - start) - (end - cursor));
      if (
        count > bestCount
        || (count === bestCount && rows > bestRows)
        || (count === bestCount && rows === bestRows && balance < bestBalance)
      ) {
        best = { start, end, hiddenBefore, hiddenAfter };
        bestCount = count;
        bestRows = rows;
        bestBalance = balance;
      }
    }
  }
  return best;
}
