type Save = () => Promise<void>;
interface WriteQueue {
  enqueue(save: Save): Promise<void>;
  flush(): Promise<void>;
}

const pendingQueues = new Set<WriteQueue>();
const keyedQueues = new Map<string, WriteQueue>();
const beforeQuit = new Set<Save>();

// Keep pending and failed writes reachable even after their editor unmounts.
export function createWriteQueue(key?: string): WriteQueue {
  const existing = key ? keyedQueues.get(key) : undefined;
  if (existing) return existing;
  let tail: Promise<void> = Promise.resolve();
  let latest: Save | null = null;
  let revision = 0;
  const queue = {
    enqueue(save: Save): Promise<void> {
      const version = ++revision;
      latest = save;
      pendingQueues.add(queue);
      const write = tail.catch(() => {}).then(save).then(() => {
        if (revision === version) {
          latest = null;
          pendingQueues.delete(queue);
        }
      });
      tail = write;
      return write;
    },
    async flush(): Promise<void> {
      const pending = tail;
      try { await pending; }
      catch (error) {
        if (tail !== pending) return queue.flush();
        if (!latest) throw error;
        await queue.enqueue(latest);
      }
      if (tail !== pending && latest) await queue.flush();
    },
  };
  if (key) keyedQueues.set(key, queue);
  return queue;
}

// Notes use a debounce; materialize those writes before waiting for the queues.
export function registerBeforeQuit(flush: Save): () => void {
  beforeQuit.add(flush);
  return () => { beforeQuit.delete(flush); };
}

export async function flushPendingWrites(): Promise<void> {
  await Promise.all([...beforeQuit].map(flush => flush()));
  while (pendingQueues.size) {
    await Promise.all([...pendingQueues].map(queue => queue.flush()));
  }
}
