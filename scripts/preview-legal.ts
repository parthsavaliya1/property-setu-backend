// Local-only preview: serves public legal pages, without a database or live account actions.
import { createServer } from "node:http";
import { deletionHtml, deletionScript, supportContact, termsHtml } from "../src/legalPages.js";
import { privacyHtml } from "../src/privacyPage.js";
createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/privacy") res.end(privacyHtml());
  else if (req.url === "/terms") res.end(termsHtml());
  else if (req.url === "/delete-account") res.end(deletionHtml());
  else if (req.url === "/delete-account.js") { res.setHeader("Content-Type", "application/javascript"); res.end(deletionScript); }
  else if (req.url === "/api/legal") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ support_email: supportContact() })); }
  else { res.statusCode = 503; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Local preview: account actions require the deployed backend." })); }
}).listen(4011, "127.0.0.1", () => console.log("Public legal page preview: http://127.0.0.1:4011/delete-account"));
