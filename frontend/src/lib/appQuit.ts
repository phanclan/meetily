interface QuitActions {
  flush: () => Promise<void>;
  complete: (requestId: number) => Promise<void>;
  cancel: (requestId: number) => Promise<void>;
  setBusy: (busy: boolean) => void;
  reportError: (error: unknown) => void;
  timeoutMs?: number;
}

export function createQuitHandler(actions: QuitActions) {
  let current: number | null = null;
  let disposed = false;
  return {
    async request(requestId: number) {
      if (disposed || current !== null) return;
      current = requestId;
      actions.setBusy(true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          actions.flush(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Saving is taking longer than expected. The app remains open; try Quit again after saving finishes.')), actions.timeoutMs ?? 30000);
          }),
        ]);
        if (!disposed) await actions.complete(requestId);
      } catch (error) {
        await actions.cancel(requestId).catch(() => {});
        if (!disposed) actions.reportError(error);
      } finally {
        if (timer) clearTimeout(timer);
        current = null;
        actions.setBusy(false);
      }
    },
    dispose() {
      disposed = true;
      if (current !== null) void actions.cancel(current).catch(() => {});
      actions.setBusy(false);
    },
  };
}
