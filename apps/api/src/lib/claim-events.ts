import { EventEmitter } from "node:events";

/**
 * Tells open receipt pages that a receipt's claims changed. In-process, which is enough for the
 * single API instance this app deploys (ADR 0002); more than one instance would need Valkey
 * pub/sub behind the same two methods.
 */
export class ClaimEvents {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  /** Call after a change is committed. */
  publish(receiptId: string): void {
    this.emitter.emit(receiptId);
  }

  /** Returns the function that stops listening. */
  subscribe(receiptId: string, listener: () => void): () => void {
    this.emitter.on(receiptId, listener);
    return () => this.emitter.off(receiptId, listener);
  }

  listenerCount(receiptId: string): number {
    return this.emitter.listenerCount(receiptId);
  }
}
