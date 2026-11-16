interface SaveSnapshot {
  documentId: string;
  revision: number;
  generation: number;
}

export class SaveFlow {
  private revision = 0;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();

  changed(): void {
    this.revision += 1;
  }

  opened(): void {
    this.generation += 1;
  }

  snapshot(documentId: string): SaveSnapshot {
    return { documentId, revision: this.revision, generation: this.generation };
  }

  isSameDocument(snapshot: SaveSnapshot, documentId: string): boolean {
    return snapshot.documentId === documentId && snapshot.generation === this.generation;
  }

  isCurrent(snapshot: SaveSnapshot, documentId: string): boolean {
    return this.isSameDocument(snapshot, documentId) && snapshot.revision === this.revision;
  }

  enqueue<T>(save: () => Promise<T>): Promise<T> {
    const result = this.tail.then(save);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
