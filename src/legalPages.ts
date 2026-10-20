function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function supportContact() {
  const email = process.env.SUPPORT_EMAIL?.trim() || "propertysetu.support@gmail.com";
  return email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

export function legalPage(title: string, body: string) {
  const email = supportContact();
  const contact = email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : "Support contact is being configured. Account deletion below remains available.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | PropertySetu</title><style>body{margin:0;background:#f7f3ec;color:#242424;font:17px/1.6 system-ui}main{max-width:760px;margin:auto;padding:32px 20px}h1{line-height:1.2}a{color:#924b30}input,button{font:inherit;padding:12px;border:1px solid #aaa;border-radius:8px;max-width:100%;box-sizing:border-box}button{cursor:pointer;background:#924b30;color:white}label{display:block;margin:14px 0}button:disabled{opacity:.5}nav{display:flex;gap:18px;flex-wrap:wrap}#notice{white-space:pre-wrap}section{margin:24px 0}input[type=checkbox]{margin-right:8px}</style></head><body><main><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete account</a></nav><h1>${escapeHtml(title)}</h1><p>Updated 19 October 2026</p>${body}<footer><h2>Contact PropertySetu</h2><p>${contact}</p></footer></main></body></html>`;
}

export function termsHtml() {
  return legalPage("Terms and community rules", `
    <h2>Using PropertySetu</h2><p>PropertySetu is a marketplace for property listings and related conversations. Use accurate information and publish only property and media you are authorised to share. You must be legally able to enter a property transaction. PropertySetu is not intended for children under 13.</p>
    <h2>Prohibited content and conduct</h2><p>Do not publish fake or misleading listings, scams, impersonation, illegal offers, discrimination, threats, harassment, hate speech, sexual exploitation, sexual content, violence, spam, or private information without permission. Do not upload material that infringes another person's rights. Never share identity documents, financial credentials or other sensitive information in public listings.</p>
    <h2>Safety and moderation</h2><p>Use Report / Block on a listing or in a conversation to report a listing or user and prevent further interactions. Blocked users can be managed in About us. Our administrators review reports and may remove listings or restrict accounts that violate these rules. Reports do not automatically establish wrongdoing. Contact support to contest a moderation decision.</p>
    <h2>Property transactions</h2><p>Verify ownership, price and documents independently before agreeing to any purchase or rental. Publishing a listing does not guarantee a buyer, tenant, transaction, or verification of ownership. Property purchase and rental payments are separate from listing-service fees.</p>
    <h2>Listing services</h2><p>Any enabled paid service must display its price, duration and benefits before purchase. Payment availability depends on platform and region. Do not send payment credentials through chat. Contact support about incorrect charges or refund requests; mandatory consumer rights remain applicable.</p>
    <h2>Your information</h2><p>The Privacy Policy explains data processing. You can delete your account in About us or using the Delete account page. Stop using the service if you do not accept these rules.</p>
  `);
}

export function deletionHtml() {
  return legalPage("Delete your PropertySetu account", `
    <p>You can request permanent deletion here without installing the app. Verify the mobile number registered to your account first. Verification does not delete your account.</p>
    <p>Deletion removes your account, profile, owned listings, chats involving your account, inquiries, visits and linked account data from the active database. Stored upload deletion is queued for processing. Copies in backups or third-party caches may persist until those systems expire or are cleared. Contact support for assistance with those copies.</p>
    <section id="phone-step"><label>Registered mobile number (India)<input id="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" pattern="[0-9]{10}" required></label><button id="send" type="button">Send verification code</button></section>
    <section id="code-step" hidden><label>Verification code<input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8"></label><button id="verify" type="button">Verify account</button></section>
    <section id="delete-step" hidden><label><input id="confirm" type="checkbox">I understand deletion is permanent and want to delete my account and associated data.</label><button id="remove" type="button" disabled>Permanently delete my account</button></section>
    <p id="notice" role="status" aria-live="polite"></p><script src="/delete-account.js" defer></script>
  `);
}

export const deletionScript = `(() => {
  const el = id => document.getElementById(id);
  let phone = '', sessionId = '', token = '', busy = false;
  const notice = message => { el('notice').textContent = message; };
  async function request(path, body, method = 'POST') {
    const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
    return result;
  }
  async function run(action) { if (busy) return; busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true); notice('Please wait…'); try { await action(); } catch (error) { notice(error.message || 'Please try again.'); } finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); el('remove').disabled = !token || !el('confirm').checked; } }
  el('send').onclick = () => run(async () => {
    const value = el('phone').value.trim();
    if (!/^[0-9]{10}$/.test(value)) throw new Error('Enter your registered 10-digit mobile number.');
    token = ''; el('delete-step').hidden = true;
    const result = await request('/auth/send-otp', { phone: value, create: false });
    phone = value; sessionId = result.sessionId; el('code-step').hidden = false; el('otp').value = ''; notice('Enter the verification code for your registered number.');
  });
  el('verify').onclick = () => run(async () => {
    const result = await request('/auth/verify-otp', { phone, otp: el('otp').value.trim(), sessionId, create: false });
    token = result.token; el('phone-step').hidden = true; el('code-step').hidden = true; el('delete-step').hidden = false; notice('Account verified. Confirm below only if you want permanent deletion.');
  });
  el('confirm').onchange = () => { el('remove').disabled = busy || !token || !el('confirm').checked; };
  el('remove').onclick = () => run(async () => {
    if (!token || !el('confirm').checked) return;
    await request('/me', undefined, 'DELETE'); token = ''; el('delete-step').hidden = true; notice('Your account has been deleted. Stored files have been queued for deletion.');
  });
})();`;
