/**
 * A small, strict XML reader for Rekordbox collection exports. It builds an element tree
 * with attributes and ignores character data, which Rekordbox does not use. It refuses
 * DOCTYPE and entity declarations, like the CLI's reader, and fails on malformed markup
 * rather than guessing. It runs in the browser and in Node, where DOMParser is absent.
 */

export interface XmlElement {
  name: string;
  attributes: Map<string, string>;
  children: XmlElement[];
}

export class XmlError extends Error {}

const NAME = /[A-Za-z_:][A-Za-z0-9_:.\-]*/y;
const SPACE = /\s*/y;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeAttribute(raw: string): string {
  // Attribute-value normalization: literal tabs and line breaks become spaces.
  const normalized = raw.replace(/\r\n|[\t\n\r]/g, " ");
  return normalized.replace(/&([^;]*);?/g, (match, body: string) => {
    if (!match.endsWith(";")) throw new XmlError("an ampersand in an attribute value is not escaped");
    if (body.startsWith("#x")) return codePoint(parseInt(body.slice(2), 16), body);
    if (body.startsWith("#")) return codePoint(parseInt(body.slice(1), 10), body);
    const value = PREDEFINED[body];
    if (value === undefined) throw new XmlError(`undefined entity &${body};`);
    return value;
  });
}

function codePoint(value: number, body: string): string {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff) throw new XmlError(`invalid character reference &${body};`);
  return String.fromCodePoint(value);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Parse a document and return its root element. */
export function parseXml(text: string): XmlElement {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const fail = (message: string, at = i): never => {
    throw new XmlError(`${message} (line ${lineOf(text, at)})`);
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      if (text.slice(i).trim() !== "" && stack.length === 0) fail("text outside the root element");
      break;
    }
    if (stack.length === 0 && text.slice(i, lt).trim() !== "") fail("text outside the root element");
    i = lt;
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end === -1) fail("unterminated processing instruction");
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end === -1) fail("unterminated comment");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      if (stack.length === 0) fail("CDATA outside the root element");
      const end = text.indexOf("]]>", i + 9);
      if (end === -1) fail("unterminated CDATA section");
      i = end + 3;
    } else if (text.startsWith("<!", i)) {
      // DOCTYPE, ENTITY, and any other declaration are refused, as the CLI does.
      fail("DOCTYPE and entity declarations are not allowed");
    } else if (text.startsWith("</", i)) {
      NAME.lastIndex = i + 2;
      const match = NAME.exec(text);
      if (!match) fail("malformed end tag");
      const name = match![0];
      SPACE.lastIndex = NAME.lastIndex;
      SPACE.exec(text);
      if (text[SPACE.lastIndex] !== ">") fail("malformed end tag");
      const open = stack.pop();
      if (!open || open.name !== name) fail(`mismatched end tag </${name}>`);
      i = SPACE.lastIndex + 1;
    } else {
      NAME.lastIndex = i + 1;
      const match = NAME.exec(text);
      if (!match) fail("malformed start tag");
      if (root && stack.length === 0) fail("more than one root element");
      const element: XmlElement = { name: match![0], attributes: new Map(), children: [] };
      let j = NAME.lastIndex;
      let selfClosing = false;
      for (;;) {
        SPACE.lastIndex = j;
        const gap = SPACE.exec(text)![0].length;
        j = SPACE.lastIndex;
        if (text[j] === ">") {
          j += 1;
          break;
        }
        if (text.startsWith("/>", j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (gap === 0) fail("attributes must be separated by whitespace", j);
        NAME.lastIndex = j;
        const attribute = NAME.exec(text);
        if (!attribute) fail("malformed attribute", j);
        j = NAME.lastIndex;
        SPACE.lastIndex = j;
        SPACE.exec(text);
        j = SPACE.lastIndex;
        if (text[j] !== "=") fail("attribute without a value", j);
        SPACE.lastIndex = j + 1;
        SPACE.exec(text);
        j = SPACE.lastIndex;
        const quote = text[j];
        if (quote !== '"' && quote !== "'") fail("attribute value must be quoted", j);
        const close = text.indexOf(quote!, j + 1);
        if (close === -1) fail("unterminated attribute value", j);
        const raw = text.slice(j + 1, close);
        if (raw.includes("<")) fail("'<' in an attribute value", j);
        const key = attribute![0];
        if (element.attributes.has(key)) fail(`duplicate attribute ${key}`, j);
        try {
          element.attributes.set(key, decodeAttribute(raw));
        } catch (error) {
          fail((error as Error).message, j);
        }
        j = close + 1;
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else root = element;
      if (!selfClosing) stack.push(element);
      i = j;
    }
  }
  if (stack.length > 0) fail(`unclosed element <${stack[stack.length - 1]!.name}>`, text.length);
  if (!root) throw new XmlError("no root element");
  return root;
}

/** Decode bytes using the encoding named in the XML declaration (UTF-8 by default). */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /^﻿?<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(declared ?? "utf-8", { fatal: true });
  } catch {
    throw new XmlError(`unsupported encoding ${declared}`);
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new XmlError(`the file is not valid ${declared ?? "UTF-8"}`);
  }
}
