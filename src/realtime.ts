import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyAccessToken } from "./auth.js";
import { withDb } from "./db.js";

let io: Server | null = null;

function origins() {
  const configured = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);
  return configured?.length ? configured : true;
}

export function attachRealtime(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: origins() },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== "string") {
        next(new Error("Sign in required"));
        return;
      }
      const user = await verifyAccessToken(token);
      socket.data.userId = user.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Sign in required"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join", async (conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId) return;
      const userId = socket.data.userId as string | undefined;
      if (!userId) return;
      try {
        const allowed = await withDb(userId, async (db) => {
          const result = await db.query(`SELECT id FROM conversations WHERE id = $1`, [conversationId]);
          return Boolean(result.rows[0]);
        });
        if (allowed) socket.join(`chat:${conversationId}`);
      } catch {
        /* the client can retry join after the next connect */
      }
    });
  });
}

export function emitChatMessage(conversationId: string, message: Record<string, unknown>) {
  const payload = { ...message };
  delete payload.mine;
  io?.to(`chat:${conversationId}`).emit("message", payload);
}

export function emitChatDeleted(conversationId: string, messageId: string) {
  io?.to(`chat:${conversationId}`).emit("deleted", { id: messageId, conversation_id: conversationId });
}

export function emitChatReaction(
  conversationId: string,
  payload: { messageId: string; reactions: Array<{ emoji: string; count: number }>; actorId: string; emoji: string | null }
) {
  io?.to(`chat:${conversationId}`).emit("reaction", payload);
}
