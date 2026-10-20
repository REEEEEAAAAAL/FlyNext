export function safeReturnPath(value: string | null): string {
  if (!value || !/^\/(?:flights|hotels|itineraries|checkout|profile|notifications|user)(?:[/?#]|$)/.test(value) || /[\\\u0000-\u001f]/.test(value)) return "/";
  const url = new URL(value, "https://flynext.invalid");
  return url.origin === "https://flynext.invalid" && /^\/(?:flights|hotels|itineraries|checkout|profile|notifications|user)(?:\/|$)/.test(url.pathname) ? url.pathname + url.search + url.hash : "/";
}

export function loginUrl(returnPath = window.location.pathname + window.location.search): string {
  return `/auth/login?next=${encodeURIComponent(safeReturnPath(returnPath))}`;
}
