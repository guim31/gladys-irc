// -----------------------------------------------------------------------------
// An IRC line holds 512 bytes, the sender prefix the server adds included: a
// long or multi-line text is cut into lines of at most `maxBytes` bytes of
// UTF-8, between words when possible, never inside a character. Control
// characters that would end the line (CR, LF, NUL) never reach the socket.
// -----------------------------------------------------------------------------

export const MAX_LINE_BYTES = 400;
// A message of Gladys longer than this is cut, the last line ending with "…".
export const MAX_LINES = 10;

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).length;

/** Cuts one line (no line break) into chunks of at most maxBytes bytes. */
function cutLine(line, maxBytes) {
  const chunks = [];
  let rest = line;
  while (bytes(rest) > maxBytes) {
    // The longest prefix of whole characters (graphemes are not split by
    // code point here: a rare flag emoji may be cut, never a UTF-8 sequence).
    const characters = Array.from(rest);
    let size = 0;
    let end = 0;
    while (end < characters.length && size + bytes(characters[end]) <= maxBytes) {
      size += bytes(characters[end]);
      end += 1;
    }
    let head = characters.slice(0, end).join('');
    const space = head.lastIndexOf(' ');
    // Between words, unless the last space is too early (one very long word).
    if (space > head.length / 2) {
      head = head.slice(0, space);
    }
    chunks.push(head.trimEnd());
    rest = rest.slice(head.length).trimStart();
  }
  if (rest !== '') {
    chunks.push(rest);
  }
  return chunks;
}

/**
 * The IRC lines of a text.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxLines]
 * @returns {string[]} never an empty line; [] for a blank text
 */
export function splitMessage(text, { maxBytes = MAX_LINE_BYTES, maxLines = MAX_LINES } = {}) {
  const lines = String(text)
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex -- NUL would end the line on some servers
    .replace(/\x00/g, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .flatMap((line) => cutLine(line, maxBytes))
    .filter((line) => line !== '');
  if (lines.length <= maxLines) {
    return lines;
  }
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${cutLine(kept[maxLines - 1], maxBytes - bytes(' …'))[0]} …`;
  return kept;
}
