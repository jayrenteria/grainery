export function createFileOpenDrain(
  consume: () => Promise<string[]>,
  open: (path: string) => Promise<unknown>
): () => Promise<void> {
  let tail = Promise.resolve();
  return () => {
    const next = tail.then(async () => {
      const paths = await consume();
      const first = paths.find((path) => typeof path === 'string' && path.length > 0);
      if (first) await open(first);
    });
    tail = next.catch(() => undefined);
    return next;
  };
}
