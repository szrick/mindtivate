// Tiny YAML-frontmatter writer, deliberately dependency-free. Only handles
// the value shapes our own content schemas use (strings, booleans, dates,
// flat arrays of strings) — it is not a general YAML serializer.

function yamlScalar(value) {
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
export function readFrontmatter(fileContents) {
  const match = fileContents.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: fileContents };
  const [, rawFrontmatter, body] = match;
  const data = {};
  for (const line of rawFrontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else data[key] = value;
  }
  return { data, body: body.trim() };
}

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}
