import { SaveOutcomeUnknown } from './save.js';

/** Coordinates the existing page edit and question metadata ports. A metadata failure never
 * reverses a page edit; Retry acts only on the failed metadata operation. */
export class QuestionDismissal {
  state: 'idle' | 'removed' | 'handle-failed' | 'restored' | 'reopen-failed' = 'idle';
  #before = '';
  #after = '';
  #wasOpen = false;
  #busy = false;
  constructor(
    private readonly ports: {
      edit(source: string, base: string): Promise<unknown>;
      handle(): Promise<void>;
      reopen(): Promise<void>;
      readHandled?(): Promise<boolean>;
    },
  ) {}
  async dismiss(before: string, after: string, wasOpen: boolean) {
    if (this.#busy || this.state !== 'idle') return;
    this.#busy = true;
    try {
      await this.ports.edit(after, before);
      this.#before = before;
      this.#after = after;
      this.#wasOpen = wasOpen;
      this.state = 'removed';
      if (wasOpen) await this.#handle();
    } finally {
      this.#busy = false;
    }
  }
  async #handle() {
    try {
      await this.ports.handle();
      this.state = 'removed';
    } catch (error) {
      let handled = false;
      if (error instanceof SaveOutcomeUnknown) {
        try {
          handled = (await this.ports.readHandled?.()) ?? false;
        } catch {
          /* Retry remains available. */
        }
      }
      this.state = handled ? 'removed' : 'handle-failed';
    }
  }
  async #reopen() {
    try {
      await this.ports.reopen();
      this.state = 'restored';
    } catch (error) {
      let reopened = false;
      if (error instanceof SaveOutcomeUnknown) {
        try {
          reopened = this.ports.readHandled ? !(await this.ports.readHandled()) : false;
        } catch {
          /* Retry remains available. */
        }
      }
      this.state = reopened ? 'restored' : 'reopen-failed';
    }
  }
  async undo() {
    if (this.#busy || (this.state !== 'removed' && this.state !== 'handle-failed')) return;
    this.#busy = true;
    try {
      await this.ports.edit(this.#before, this.#after);
      this.state = 'restored';
      if (this.#wasOpen) await this.#reopen();
    } finally {
      this.#busy = false;
    }
  }
  async retry() {
    if (this.#busy) return;
    this.#busy = true;
    try {
      if (this.state === 'handle-failed') await this.#handle();
      else if (this.state === 'reopen-failed') await this.#reopen();
    } finally {
      this.#busy = false;
    }
  }
}
