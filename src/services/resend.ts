import { HttpError } from "../errors.js";

type VerificationMail = {
  to: string;
  name?: string | null;
  verifyUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] || char;
  });
}

export async function sendVerificationEmail({ to, name, verifyUrl }: VerificationMail) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "PropertySetu <onboarding@resend.dev>";
  if (!key) {
    throw new HttpError(503, "Email is not configured. Add RESEND_API_KEY on the server.");
  }

  const greeting = name?.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hi,";
  const safeUrl = escapeHtml(verifyUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Verify your PropertySetu email",
      html: `<div style="font-family:Georgia,serif;background:#F7F3EC;padding:32px 16px;color:#171717">
        <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px 24px">
          <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8F4F32">PropertySetu</p>
          <h1 style="margin:0 0 12px;font-size:24px">Verify your email</h1>
          <p style="margin:0 0 8px;line-height:1.5">${greeting}</p>
          <p style="margin:0 0 20px;line-height:1.5;color:#6F6A64">Open this link to confirm your email. After that, you can log in. The link expires in 24 hours.</p>
          <a href="${safeUrl}" style="display:inline-block;background:#B56A45;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Verify email</a>
          <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6F6A64">If the button does not open, paste this address into your browser:<br><a href="${safeUrl}" style="color:#8F4F32">${safeUrl}</a></p>
        </div>
      </div>`,
      text: `${name?.trim() ? `Hi ${name.trim()},` : "Hi,"}\n\nVerify your PropertySetu email by opening this link:\n${verifyUrl}\n\nThe link expires in 24 hours. After you open it, come back to the app and log in.`,
    }),
  });

  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  console.error("Resend rejected the verification email", response.status, body.message || "");
  const extra = process.env.NODE_ENV === "development" && body.message ? ` ${body.message}` : "";
  throw new HttpError(502, `Could not send the verification email.${extra}`);
}

export function verificationPage(title: string, message: string, ok = false) {
  const color = ok ? "#4F7D5B" : "#8F4F32";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;font-family:Georgia,serif;background:#F7F3EC;color:#171717">
  <main style="max-width:440px;margin:48px auto;background:#fff;border-radius:18px;padding:28px 24px">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${color}">PropertySetu</p>
    <h1 style="margin:0 0 12px;font-size:28px">${escapeHtml(title)}</h1>
    <p style="margin:0;line-height:1.5;color:#6F6A64">${escapeHtml(message)}</p>
  </main>
</body>
</html>`;
}
