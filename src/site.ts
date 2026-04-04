const rawBase = import.meta.env.BASE_URL || '/';

function normalizeBasePath(base: string) {
  if (!base || base === '/') return '/';
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export const BASE_PATH = normalizeBasePath(rawBase);

export function withBasePath(path: string) {
  if (!path) return BASE_PATH;
  if (/^(?:https?:)?\/\//.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_PATH}${normalizedPath}`;
}

export function stripBasePath(path: string) {
  if (!path) return '/';
  if (BASE_PATH === '/') return path || '/';
  if (path === BASE_PATH.slice(0, -1)) return '/';
  if (path.startsWith(BASE_PATH)) {
    const stripped = `/${path.slice(BASE_PATH.length)}`.replace(/\/+/g, '/');
    return stripped === '//' ? '/' : stripped;
  }

  return path || '/';
}

export function toAbsoluteSiteUrl(path: string) {
  if (typeof window !== 'undefined') {
    return new URL(withBasePath(path), window.location.origin).toString();
  }

  return withBasePath(path);
}
