/**
 * Read-only view of the public Vapi Studio repos on GitHub for the docs advisor.
 * Only files listed in each repo's git tree can be read — no arbitrary URLs.
 */

export const DOC_REPOS = [
  {
    id: 'guidify-ai/vapi-studio',
    role: 'the Vapi Studio framework (npm package @guidify-ai/vapi-studio) and its documentation',
  },
  {
    id: 'guidify-ai/vapi-studio-project',
    role: 'the public starter app to clone when starting a new bot project',
  },
] as const;

export type DocRepoId = (typeof DOC_REPOS)[number]['id'];

export function isDocRepo(id: string): id is DocRepoId {
  return DOC_REPOS.some((r) => r.id === id);
}

const TTL_MS = 60 * 60 * 1000;
const MAX_FILE_CHARS = 16_000;
const SKIP_FILE_RE =
  /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|woff2?|ttf|map)$/i;

type Cached<T> = { at: number; value: T };

export class RepoDocs {
  private readonly trees = new Map<string, Cached<string[]>>();
  private readonly files = new Map<string, Cached<string>>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly githubToken: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Text file paths in the repo (cached for an hour). */
  async list(repo: DocRepoId): Promise<string[]> {
    const hit = this.trees.get(repo);
    if (hit && this.now() - hit.at < TTL_MS) return hit.value;
    const res = await this.fetchImpl(
      `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vapi-studio-landing-docs',
          ...(this.githubToken ? { Authorization: `Bearer ${this.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) throw new Error(`GitHub tree ${repo}: ${res.status}`);
    const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
    const paths = (data.tree || [])
      .filter((e) => e.type === 'blob' && !SKIP_FILE_RE.test(e.path))
      .map((e) => e.path)
      .sort();
    this.trees.set(repo, { at: this.now(), value: paths });
    return paths;
  }

  /** File text, or null when the path is not in the repo tree. */
  async read(repo: string, path: string): Promise<string | null> {
    if (!isDocRepo(repo)) return null;
    const clean = path.trim().replace(/^\/+/, '');
    const listed = await this.list(repo);
    if (!listed.includes(clean)) return null;
    const key = `${repo}:${clean}`;
    const hit = this.files.get(key);
    if (hit && this.now() - hit.at < TTL_MS) return hit.value;
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${clean
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`GitHub raw ${repo}/${clean}: ${res.status}`);
    const text = (await res.text()).slice(0, MAX_FILE_CHARS);
    this.files.set(key, { at: this.now(), value: text });
    return text;
  }

  /** Prefetch trees + READMEs so the first question isn't slow. */
  async warm(): Promise<void> {
    await Promise.all(
      DOC_REPOS.map(async (r) => {
        await this.list(r.id);
        await this.read(r.id, 'README.md');
      }),
    );
  }
}
