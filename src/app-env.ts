export type AppEnv = 'local' | 'prod';

/** APP_ENV=local|prod. Anything else counts as local, so a misconfigured server never passes for prod. */
export function appEnv(): AppEnv {
  return process.env.APP_ENV?.trim().toLowerCase() === 'prod' ? 'prod' : 'local';
}

/** Every email subject goes through this: outside prod it starts with [ENV: LOCAL]. */
export function envSubject(subject: string): string {
  return appEnv() === 'prod' ? subject : `[ENV: ${appEnv().toUpperCase()}] ${subject}`;
}
