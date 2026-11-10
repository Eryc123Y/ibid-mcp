const encoder = new TextEncoder();
export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
/** HMAC verification is constant-time in WebCrypto, including unequal input lengths. */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', encoder.encode('litscout-constant-time-comparison'), {name:'HMAC', hash:'SHA-256'}, false, ['sign','verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(left));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(right));
}
export function pairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Rejection sampling avoids modulo bias (alphabet has 31 symbols).
  let code = '';
  while (code.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < Math.floor(256 / alphabet.length) * alphabet.length) code += alphabet[byte % alphabet.length];
      if (code.length === 8) break;
    }
  }
  return code;
}
