// Debounce bursts of requests and serialize compilation/application. Keeping
// this independent of app.start also allows failures/races to be regression tested.
export class CssReloader {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private compiling = false;
  private dirty = false;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor(private compile: () => Promise<void>, private delay = 200) {}

  request(): Promise<void> {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    const promise = new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delay);
    return promise;
  }

  private async run(): Promise<void> {
    if (this.compiling) return;
    this.compiling = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        const waiters = this.waiters.splice(0);
        try {
          await this.compile();
          waiters.forEach(({ resolve }) => resolve());
        } catch (error) {
          waiters.forEach(({ reject }) => reject(error));
        }
      }
    } finally {
      this.compiling = false;
    }
  }
}
