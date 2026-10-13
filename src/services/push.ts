import { pool } from "../db.js";

type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

type ExpoTicket = {
  status?: string;
  details?: { error?: string };
};

export async function savePushToken(userId: string, token: string, platform: string | null) {
  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [userId, token, platform]
  );
}

export async function sendPush(userId: string, message: PushMessage) {
  if (!userId) return;
  try {
    const saved = await pool.query<{ token: string }>(
      `SELECT token FROM push_tokens WHERE user_id = $1`,
      [userId]
    );
    const tokens = saved.rows.map((row) => row.token).filter((token) => token.startsWith("ExponentPushToken"));
    if (!tokens.length) return;
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tokens.map((token) => ({
        to: token,
        title: message.title,
        body: message.body,
        sound: "default",
        priority: "high",
        channelId: "default",
        data: message.data ?? {},
      }))),
    });
    const payload = await response.json().catch(() => ({})) as { data?: ExpoTicket[] };
    const expired = (payload.data ?? [])
      .map((ticket, index) => (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered" ? tokens[index] : ""))
      .filter(Boolean);
    if (expired.length) {
      await pool.query(`DELETE FROM push_tokens WHERE token = ANY($1::text[])`, [expired]);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Push notification failed");
  }
}
