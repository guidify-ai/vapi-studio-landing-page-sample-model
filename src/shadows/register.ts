/**
 * Optional app-owned event hooks (private modules gitignored).
 * Call from `main.ts` before listen.
 */
export function registerEventShadows(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./event-export');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'MODULE_NOT_FOUND' && /event-export/.test(err.message)) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn('[shadows] private event hook failed to load');
  }
}
