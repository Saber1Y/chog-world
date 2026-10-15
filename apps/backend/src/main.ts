import "reflect-metadata";
import { Logger, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "./config/env.js";
import { APP_CONTEXT, buildContext, type AppContext } from "./app/context.js";
import { Loops } from "./app/loops.js";
import { ArenaController, ChogsController, OwnersController, WorldController } from "./api/controllers.js";
import { JournalGateway } from "./api/gateway.js";

async function bootstrap() {
  const env = loadEnv();
  const ctx = await buildContext(env, (scope, msg) => new Logger(scope).log(msg));
  const log = new Logger("bootstrap");
  log.log(
    `chain=${ctx.chain.chain.id} operator=${ctx.chain.deployment.operator} keeper=${ctx.chain.keeper.account.address} ` +
      `db=${ctx.dbHandle.kind} llm=${ctx.llmEnabled ? env.AGENT_MODEL : "off (heuristic)"} agent=${env.AGENT_ENABLED ? "on" : "off"}`,
  );

  @Module({
    controllers: [WorldController, OwnersController, ChogsController, ArenaController],
    providers: [{ provide: APP_CONTEXT, useValue: ctx satisfies AppContext }, Loops, JournalGateway],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const allowed = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: allowed, credentials: false });
  app.get(Loops);
  await app.listen(env.PORT, env.HOST);
  log.log(`CHOG World backend listening on ${env.HOST}:${env.PORT}`);

  const close = async () => {
    await app.close();
    await ctx.dbHandle.close();
  };
  process.once("SIGTERM", () => void close().then(() => process.exit(0)));
  process.once("SIGINT", () => void close().then(() => process.exit(0)));
}

process.on("unhandledRejection", (reason) => {
  new Logger("process").error(`unhandled rejection: ${(reason as Error)?.message?.split("\n")[0] ?? String(reason)}`);
});

bootstrap().catch((err: Error) => {
  new Logger("bootstrap").error(`backend failed to start: ${err.message?.split("\n")[0] ?? err}`);
  process.exit(1);
});
