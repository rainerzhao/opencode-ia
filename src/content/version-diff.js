'use strict';

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 2000;

function normalizeText(value) {
  if (typeof value !== 'string') throw new TypeError('version text must be a string');
  if (Buffer.byteLength(value, 'utf8') > MAX_DIFF_BYTES) throw new Error('version diff is too large');
  return value.split('\n');
}

function push(hunks, type, line) {
  const current = hunks.at(-1);
  if (current?.type === type) current.lines.push(line);
  else hunks.push({ type, lines: [line] });
}

function diffText(before, after) {
  const oldLines = normalizeText(before);
  const newLines = normalizeText(after);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) throw new Error('version diff is too large');
  const width = newLines.length + 1;
  let previous = new Uint32Array(width);
  const rows = [];
  for (let oldIndex = 0; oldIndex < oldLines.length; oldIndex += 1) {
    const current = new Uint32Array(width);
    for (let newIndex = 0; newIndex < newLines.length; newIndex += 1) {
      current[newIndex + 1] = oldLines[oldIndex] === newLines[newIndex]
        ? previous[newIndex] + 1
        : Math.max(previous[newIndex + 1], current[newIndex]);
    }
    rows.push(previous);
    previous = current;
  }
  rows.push(previous);

  const reversed = [];
  let oldIndex = oldLines.length;
  let newIndex = newLines.length;
  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && oldLines[oldIndex - 1] === newLines[newIndex - 1]) {
      reversed.push({ type: 'equal', line: oldLines[oldIndex - 1] });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (newIndex > 0 && (oldIndex === 0 || rows[oldIndex][newIndex - 1] >= rows[oldIndex - 1][newIndex])) {
      reversed.push({ type: 'add', line: newLines[newIndex - 1] });
      newIndex -= 1;
    } else {
      reversed.push({ type: 'remove', line: oldLines[oldIndex - 1] });
      oldIndex -= 1;
    }
  }
  const hunks = [];
  for (const item of reversed.reverse()) push(hunks, item.type, item.line);
  const summary = { additions: 0, removals: 0, unchanged: 0 };
  for (const hunk of hunks) summary[hunk.type === 'add' ? 'additions' : hunk.type === 'remove' ? 'removals' : 'unchanged'] += hunk.lines.length;
  return { summary, hunks };
}

module.exports = { diffText, MAX_DIFF_BYTES, MAX_DIFF_LINES };
