/** Isomorphic base64 helpers (browser + Node) for small binary payloads. */

// btoa/atob exist in browsers and Node >= 16 but are not part of the ES lib typings.
const g = globalThis as unknown as { btoa(data: string): string; atob(data: string): string };

export function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return g.btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = g.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// TextEncoder/TextDecoder: same story (browser + Node globals, not in ES lib typings).
interface Utf8Globals {
  TextEncoder: new () => { encode(s: string): Uint8Array };
  TextDecoder: new (label?: string, opts?: { fatal?: boolean }) => { decode(b: Uint8Array): string };
}
const textApi = globalThis as unknown as Utf8Globals;

export function utf8Encode(s: string): Uint8Array {
  return new textApi.TextEncoder().encode(s);
}

/** Decode UTF-8; with `fatal` (default) invalid byte sequences throw instead of becoming U+FFFD. */
export function utf8Decode(bytes: Uint8Array, fatal = true): string {
  return new textApi.TextDecoder('utf-8', { fatal }).decode(bytes);
}
