/**
 * The repository's star count, read once while the site builds (next.config.mjs) and baked into
 * the pages: the browser never asks GitHub. Any failure (no network, a rate limit, a timeout, an
 * answer without a number) means no count, never a failed build.
 */

export const GITHUB_REPOSITORY = 'Meerzus/cloudlet';
export const GITHUB_API = 'https://api.github.com';

/**
 * @param {{
 *   fetch?: typeof globalThis.fetch,
 *   api?: string,
 *   token?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<number | undefined>}
 */
export async function fetchGitHubStars({ fetch = globalThis.fetch, api = GITHUB_API, token, timeoutMs = 5000 } = {}) {
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'cloudlet-site-build' };
    // Vercel's builders share IPs, and GitHub allows 60 anonymous requests an hour per IP.
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${api.replace(/\/+$/, '')}/repos/${GITHUB_REPOSITORY}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    const { stargazers_count: stars } = await response.json();
    return Number.isSafeInteger(stars) && stars >= 0 ? stars : undefined;
  } catch {
    return undefined;
  }
}
