/** HTML for the consent page and simple status pages. Everything client-supplied is escaped. */

import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 16px;color:#1d1d1f;background:#fff}" +
  "button{font:inherit;padding:.5rem 1.2rem;margin-right:.5rem;border-radius:6px;border:1px solid #888;cursor:pointer}" +
  "button[value=approve]{background:#1f6feb;color:#fff;border-color:#1f6feb}" +
  ".warn{background:#fff4e5;padding:.6rem;border-radius:6px}" +
  "@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.warn{background:#3a2a10}}";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style><body>${body}</body></html>`;
}

export function consentPage(
  details: ConsentDescription,
  handle: string,
): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>`
    : "";
  return page(
    `Authorize ${details.clientName}`,
    `<h1>Allow ${name} to use LitScout?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopback}
<p>Enter the pairing code from the CLI.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<label>Pairing code <input name="code" autocomplete="one-time-code" maxlength="8" required></label>
<button name="decision" value="approve">Allow</button><button name="decision" value="deny" formnovalidate>Deny</button>
</form>`,
  );
}

export function messagePage(
  title: string,
  message: string,
  status: number,
): Response {
  return new Response(
    page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`),
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-frame-options": "DENY",
        "cache-control": "no-store",
      },
    },
  );
}
