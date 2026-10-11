import { Inject, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server } from "socket.io";
import { eq } from "drizzle-orm";
import { APP_CONTEXT, type AppContext } from "../app/context.js";
import { chogs } from "../database/schema.js";

/**
 * Pushes journal entries live. Clients join `chog:<tokenId>` for one Chog, or listen to `world`
 * for everything.
 */
@WebSocketGateway({ cors: { origin: true } })
export class JournalGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private off: (() => void) | undefined;

  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  onModuleInit() {
    this.off = this.ctx.journal.onEntry((row) => {
      void (async () => {
        const [c] = await this.ctx.dbHandle.db.select({ tokenId: chogs.tokenId, nickname: chogs.nickname }).from(chogs).where(eq(chogs.key, row.chogKey));
        const payload = { ...row, tokenId: c?.tokenId ?? null, nickname: c?.nickname ?? null };
        this.server.emit("world", payload);
        if (c) this.server.to(`chog:${c.tokenId}`).emit("journal", payload);
      })();
    });
    this.server.on("connection", (socket) => {
      socket.on("watch", (tokenId: unknown) => {
        if (typeof tokenId === "string" && /^\d{1,6}$/.test(tokenId)) void socket.join(`chog:${tokenId}`);
      });
    });
  }

  onModuleDestroy() {
    this.off?.();
  }
}
