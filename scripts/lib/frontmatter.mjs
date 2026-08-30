// Tiny YAML-frontmatter writer, deliberately dependency-free. Only handles
// the value shapes our own content schemas use (strings, booleans, dates,
// flat arrays of strings) — it is not a general YAML serializer.

export function yamlScalar(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  const str = String(value);
  const needsQuotes = /[:#\-{}[\],&*!|>'"%@`]/.test(str) || str !== str.trim() || str === '';
  if (needsQuotes) {
    return JSON.stringify(str);
  }
  return str;
}

function yamlValue(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '\n' + value.map((item) => `${indent}  - ${yamlScalar(item)}`).join('\n');
  }
  return yamlScalar(value);
}

export function toFrontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${yamlValue(value)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

export function writeMarkdownFile({ frontmatter, body }) {
  return `${toFrontmatter(frontmatter)}\n${body.trim()}\n`;
}

// Very small frontmatter reader — enough to pull flat string/boolean
// fields back out of files this same module wrote. Not a general YAML
// parser; nested structures (lists, references) are intentionally left as
// raw strings for the caller to handle.
//
// \r?\n throughout this file: git on Windows checks files out with CRLF
// by default (no .gitattributes forcing LF here), so a plain \n match
// silently fails on every field read on a Windows checkout.
export function readFrontmatter(fileContents) {
  const match = fileContents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: fileContents };
  const [, rawFrontmatter, body] = match;
  return { data: parseFlatYamlLines(rawFrontmatter), body: body.trim() };
}

// Same flat string/boolean line parsing as readFrontmatter, but for a
// standalone YAML file with no `---` frontmatter fences around it (e.g.
// src/content/settings/site.yml) — shared here so the two never drift.
export function parseFlatYaml(fileContents) {
  return parseFlatYamlLines(fileContents);
}

// Handles YAML's `>` (folded) and `|` (literal) block scalars, e.g.:
//   description: >
//     Wrapped across a couple of
//     lines for readability.
// Without this, a `>`/`|` value line parses as the literal one-character
// string ">" or "|" and every indented line under it is silently dropped
// (each lacks a ":", so the line-by-line loop below just skips it) —
// this bit every pipeline script that reads `description` as an LLM
// drafting input, since most existing article files write it this way
// for readability even though toFrontmatter (this file's writer) never
// produces this form itself. Continuation lines are collected while they
// stay indented; the next unindented line ends the block scalar, same as
// real YAML.
function parseFlatYamlLines(text) {
  const lines = text.split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (value === '>' || value === '|') {
      const joiner = value === '>' ? ' ' : '\n';
      const collected = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        collected.push(lines[++i].trim());
      }
      data[key] = collected.join(joiner);
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else data[key] = value;
  }
  return data;
}

// Inserts a single flat field into an existing file's frontmatter block
// without touching anything else — deliberately not a parse+rewrite
// round-trip, since readFrontmatter/toFrontmatter would flatten multi-line
// ">" block scalars (e.g. problemSolved) that already exist in hand-edited
// content files. No-ops if the key is already present.
export function insertFrontmatterField(fileContents, key, value, { comment } = {}) {
  const match = fileContents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error('File has no frontmatter block to insert into');
  const nl = match[0].includes('\r\n') ? '\r\n' : '\n';
  const rawFrontmatter = match[1];
  const alreadySet = rawFrontmatter.split(/\r?\n/).some((line) => line.trim().startsWith(`${key}:`));
  if (alreadySet) return fileContents;

  const commentBlock = comment
    ? comment
        .split('\n')
        .map((line) => `# ${line}`)
        .join(nl) + nl
    : '';
  const insertion = `${commentBlock}${key}: ${yamlValue(value)}`;
  const newFrontmatterBlock = `---${nl}${rawFrontmatter}${nl}${insertion}${nl}---${nl}`;
  return fileContents.slice(0, match.index) + newFrontmatterBlock + fileContents.slice(match.index + match[0].length);
}

// Sets a single flat frontmatter field, updating it in place if already
// present (unlike insertFrontmatterField, which no-ops on an existing
// key) or inserting it if not. Same "touch only this one line, leave
// everything else — including hand-written multi-line block scalars —
// untouched" approach, so it's safe to use on already-published,
// human-edited files.
export function upsertFrontmatterField(fileContents, key, value) {
  const match = fileContents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error('File has no frontmatter block to update');
  const nl = match[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/);
  const idx = lines.findIndex((line) => line.trim().startsWith(`${key}:`));
  if (idx === -1) return insertFrontmatterField(fileContents, key, value);

  // The existing value may itself be a multi-line YAML list (an array
  // previously written by this same module) -- consume any continuation
  // lines (indented "- item" entries right after the key) along with the
  // key line itself, so overwriting an array field doesn't leave its old
  // items behind as orphaned list entries.
  let end = idx + 1;
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;

  lines.splice(idx, end - idx, `${key}: ${yamlValue(value)}`);
  const newFrontmatterBlock = `---${nl}${lines.join(nl)}${nl}---${nl}`;
  return fileContents.slice(0, match.index) + newFrontmatterBlock + fileContents.slice(match.index + match[0].length);
}

// Removes a single flat frontmatter field entirely (e.g. dropping a hero
// image that failed QA) -- no-ops if the key isn't present. Same
// line-level, don't-touch-anything-else approach as insert/upsert above.
export function removeFrontmatterField(fileContents, key) {
  const match = fileContents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return fileContents;
  const nl = match[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/).filter((line) => !line.trim().startsWith(`${key}:`));
  const newFrontmatterBlock = `---${nl}${lines.join(nl)}${nl}---${nl}`;
  return fileContents.slice(0, match.index) + newFrontmatterBlock + fileContents.slice(match.index + match[0].length);
}

// Swaps out everything after the frontmatter block, leaving the block
// itself byte-for-byte untouched. Paired with upsertFrontmatterField
// above when a script needs to both bump a field (e.g. updatedDate) and
// edit the body in the same pass.
export function replaceArticleBody(fileContents, newBody) {
  const match = fileContents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error('File has no frontmatter block');
  return fileContents.slice(0, match.index + match[0].length) + newBody.trim() + '\n';
}

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}
