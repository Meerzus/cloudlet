import { describe, expect, it, vi } from 'vitest';
import { fetchGitHubStars } from '../../apps/site/scripts/github-stars.mjs';
import { formatStars, parseStars } from '@/lib/stars';

describe('star count format', () => {
  it('shows nothing below 100 stars', () => {
    for (const stars of [undefined, 0, 41, 99, Number.NaN, -5]) expect(formatStars(stars)).toBeUndefined();
  });

  it('shows 100 to 999 as they are, then thousands rounded down', () => {
    const cases: [number, string][] = [
      [100, '100'], [128, '128'], [999, '999'],
      [1000, '1k'], [1049, '1k'], [1234, '1.2k'], [1999, '1.9k'], [9999, '9.9k'],
      [10_000, '10k'], [12_345, '12k'], [999_999, '999k'],
      [1_000_000, '1M'], [1_250_000, '1.2M'],
    ];
    for (const [stars, shown] of cases) expect(formatStars(stars), String(stars)).toBe(shown);
  });

  it('reads the count the build inlined, empty meaning none', () => {
    expect(parseStars('128')).toBe(128);
    expect(parseStars('')).toBeUndefined();
    expect(parseStars(undefined)).toBeUndefined();
    expect(parseStars('12k')).toBeUndefined();
  });
});

describe('star count from GitHub at build time', () => {
  const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('asks the repository, with the token when there is one', async () => {
    const fetch = answer({ stargazers_count: 1234 });
    expect(await fetchGitHubStars({ fetch, token: 'secret' })).toBe(1234);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/Meerzus/cloudlet');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no authorization without a token, and takes another API host', async () => {
    const fetch = answer({ stargazers_count: 41 });
    expect(await fetchGitHubStars({ fetch, api: 'http://github.invalid/' })).toBe(41);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://github.invalid/repos/Meerzus/cloudlet');
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('gives no count on any failure instead of throwing', async () => {
    expect(await fetchGitHubStars({ fetch: answer({ message: 'API rate limit exceeded' }, 403) })).toBeUndefined();
    expect(await fetchGitHubStars({ fetch: answer({ stargazers_count: '128' }) })).toBeUndefined();
    expect(await fetchGitHubStars({ fetch: answer({}) })).toBeUndefined();
    expect(await fetchGitHubStars({ fetch: vi.fn(async () => new Response('not json')) })).toBeUndefined();
    expect(await fetchGitHubStars({ fetch: vi.fn(async () => { throw new TypeError('fetch failed'); }) })).toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    expect(await fetchGitHubStars({ fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 10 })).toBeUndefined();
  });
});
