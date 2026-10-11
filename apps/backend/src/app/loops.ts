import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { APP_CONTEXT, type AppContext } from "./context.js";

/**
 * Background work on fixed intervals. Each job guards against overlapping itself, and a failure is
 * logged and retried on the next interval rather than taking the server down.
 */
@Injectable()
export class Loops implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("loops");
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  onApplicationBootstrap() {
    const { env } = this.ctx;
    this.every("indexer", env.INDEX_INTERVAL_SEC, () => this.ctx.indexer.run());
    this.every("resolver", env.RESOLVE_INTERVAL_SEC, () => this.ctx.resolver.run());
    this.every("holders", env.HOLDERS_INTERVAL_SEC, () => this.ctx.holders.refresh(), true);
    if (env.AGENT_ENABLED) this.every("agent", env.SCHEDULER_INTERVAL_SEC, () => this.ctx.agent.sweep());
    else this.log.warn("AGENT_ENABLED=false: Chogs will not act on their own");
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }

  private every(name: string, seconds: number, job: () => Promise<unknown>, runNow = false) {
    const run = () =>
      job().catch((err: Error) => this.log.warn(`${name}: ${err.message?.split("\n")[0] ?? String(err)}`));
    if (runNow) void run();
    this.timers.push(setInterval(run, seconds * 1000));
  }
}
