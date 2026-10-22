# Security policy

Ibid runs in each user's own Cloudflare account and holds their API keys, so
security reports are taken seriously.

**Report vulnerabilities privately** through GitHub's "Report a vulnerability"
button (Security tab → Advisories). Please do not open a public issue.

The following areas are in scope:
- the pairing-code flow: brute-force resistance, expiry and races;
- the OAuth flow and token handling;
- authentication on the `/admin/*` routes;
- leakage of secrets through logs, errors or responses.
