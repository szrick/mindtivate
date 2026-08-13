// Prefixes an internal, root-relative path with the site's configured base
// path (see `base` in astro.config.mjs) so links and static-asset
// references keep working when the site is served from a subpath — e.g.
// the default GitHub Pages project URL https://szrick.github.io/mindtivate/
// — not just from the domain root.
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
