/**
 * Renders an FTS snippet. The main process marks matched spans with \u0001 /
 * \u0002 control characters (they cannot collide with document text), which we
 * turn into <mark> elements here. Everything else stays plain text, so snippet
 * rendering cannot inject HTML from a document body.
 */

import { Fragment } from 'react';

const START = '\u0001';
const END = '\u0002';

export function Snippet({ text }: { text: string }) {
  const parts: { text: string; hit: boolean }[] = [];
  let rest = text;

  while (rest.length > 0) {
    const start = rest.indexOf(START);
    if (start === -1) {
      parts.push({ text: rest, hit: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), hit: false });
    const end = rest.indexOf(END, start + 1);
    if (end === -1) {
      parts.push({ text: rest.slice(start + 1), hit: false });
      break;
    }
    parts.push({ text: rest.slice(start + 1, end), hit: true });
    rest = rest.slice(end + 1);
  }

  return (
    <span className="selectable">
      {parts.map((p, i) =>
        p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </span>
  );
}
