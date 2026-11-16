export declare const GITHUB_REPOSITORY: string;
export declare const GITHUB_API: string;
export declare function fetchGitHubStars(options?: {
  fetch?: typeof globalThis.fetch;
  api?: string;
  token?: string;
  timeoutMs?: number;
}): Promise<number | undefined>;
