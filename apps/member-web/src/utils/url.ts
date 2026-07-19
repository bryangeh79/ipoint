/**
 * Validates that a returnUrl is same-origin to prevent open redirect vulnerabilities.
 * Returns the validated relative path or null.
 */
export function validateReturnUrl(returnUrl: string | null): string | null {
  if (!returnUrl) return null;

  try {
    const url = new URL(returnUrl, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }
    // Only allow path-based URLs (no full URLs redirecting elsewhere)
    return url.pathname + url.search + url.hash;
  } catch {
    // If it's a relative path without host, construct full URL to validate
    if (returnUrl.startsWith('/')) {
      try {
        const url = new URL(returnUrl, window.location.origin);
        return url.pathname + url.search + url.hash;
      } catch {
        return null;
      }
    }
    return null;
  }
}
