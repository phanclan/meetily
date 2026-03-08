const calledUnlisteners = new WeakSet<() => void | Promise<void>>();

export function safelyUnlisten(
  unlisten?: (() => void | Promise<void>) | null,
  label?: string,
) {
  if (!unlisten) return;
  if (calledUnlisteners.has(unlisten)) return;
  calledUnlisteners.add(unlisten);

  try {
    void Promise.resolve(unlisten()).catch((error) => {
      console.warn(`[tauriEvents] Failed to unlisten${label ? ` (${label})` : ''}:`, error);
    });
  } catch (error) {
    console.warn(`[tauriEvents] Failed to unlisten${label ? ` (${label})` : ''}:`, error);
  }
}
