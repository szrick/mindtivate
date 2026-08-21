// Client-side only. Bookmarks are a lightweight, no-account feature: saved
// articles live in this browser's localStorage and never touch a server,
// so there's no sync across devices — see the tradeoff this was chosen
// over. Never import this from Astro frontmatter (server-side); it's only
// meant for use inside component <script> tags.
const STORAGE_KEY = 'mindtivate:bookmarks';
const CHANGE_EVENT = 'mindtivate:bookmarks-change';

export interface Bookmark {
  slug: string;
  title: string;
  category: string;
  heroImage?: string;
  pubDate: string;
  savedAt: string;
}

function read(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // Storage unavailable (private browsing, quota, disabled) — the save
    // button just won't persist; nothing else to do about it here.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function getBookmarks(): Bookmark[] {
  return read().sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

export function isBookmarked(slug: string): boolean {
  return read().some((b) => b.slug === slug);
}

export function addBookmark(bookmark: Bookmark): void {
  const bookmarks = read().filter((b) => b.slug !== bookmark.slug);
  bookmarks.push(bookmark);
  write(bookmarks);
}

export function removeBookmark(slug: string): void {
  write(read().filter((b) => b.slug !== slug));
}

export function toggleBookmark(bookmark: Bookmark): boolean {
  if (isBookmarked(bookmark.slug)) {
    removeBookmark(bookmark.slug);
    return false;
  }
  addBookmark(bookmark);
  return true;
}

// Fires on same-tab changes (CHANGE_EVENT) and other-tab changes (the
// native 'storage' event), so a header badge or the /saved list can stay
// in sync with a bookmark button toggled elsewhere.
export function onBookmarksChange(callback: () => void): () => void {
  const storageListener = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', storageListener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', storageListener);
  };
}
