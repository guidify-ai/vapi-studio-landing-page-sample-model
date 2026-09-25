import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Local human identity — one app deploy = one project (name + slug). */
export interface ProjectIdentity {
  slug: string;
  name: string;
}

/**
 * Stable internal DB key for the single local project row.
 * Not used in public URLs — each fork has its own host/port.
 * Kept as the sample's historical UUID so existing DB rows keep working.
 */
export const LOCAL_PROJECT_ID = '4a13e554-972b-4713-b208-15b71bff0493';

let cached: ProjectIdentity | null = null;

/**
 * Canonical name/slug from config/project.identity.json.
 */
export function loadProjectIdentity(configDir?: string): ProjectIdentity {
  if (cached) return cached;
  const dir = configDir ?? process.env.CONFIG_DIR ?? join(process.cwd(), 'config');
  const path = join(dir, 'project.identity.json');
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. Create it with name + slug — do not invent a UUID at runtime.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectIdentity>;
  const slug = String(raw.slug ?? '').trim();
  const name = String(raw.name ?? '').trim();
  if (!slug || !name) throw new Error('project.identity.json needs name and slug');
  cached = { slug, name };
  return cached;
}

/** Internal DB project id only — not a public URL segment. */
export function resolveProjectUuid(): string {
  return LOCAL_PROJECT_ID;
}

export function projectVapiBasePath(): string {
  return '/vapi';
}

export function projectWebhookUrl(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/\/$/, '') + projectVapiBasePath() + '/webhook';
}

export function projectChatCompletionsUrl(
  publicBaseUrl: string,
  moduleId?: string | null,
): string {
  const root = publicBaseUrl.replace(/\/$/, '') + projectVapiBasePath();
  if (moduleId?.trim()) return root + '/' + moduleId.trim() + '/chat/completions';
  return root + '/chat/completions';
}
