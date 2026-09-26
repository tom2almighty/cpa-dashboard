const ENC_PREFIX = "enc::v1::";
const SECRET_SALT = "cpa-dashboard::secure-storage";

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function getKeyBytes(): Uint8Array {
  try {
    const host = typeof window !== "undefined" ? (window.location?.host ?? "") : "";
    const ua = typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "";
    return encodeText(`${SECRET_SALT}|${host}|${ua}`);
  } catch {
    return encodeText(SECRET_SALT);
  }
}

function xorBytes(data: Uint8Array, keyBytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function obfuscate(value: string): string {
  if (!value) return value;
  try {
    const encrypted = xorBytes(encodeText(value), getKeyBytes());
    return `${ENC_PREFIX}${toBase64(encrypted)}`;
  } catch {
    return value;
  }
}

export function deobfuscate(payload: string): string {
  if (!payload?.startsWith(ENC_PREFIX)) {
    return payload;
  }
  try {
    const encodedBody = payload.slice(ENC_PREFIX.length);
    const decrypted = xorBytes(fromBase64(encodedBody), getKeyBytes());
    return decodeText(decrypted);
  } catch {
    return payload;
  }
}

export function isObfuscated(value: string): boolean {
  return Boolean(value?.startsWith(ENC_PREFIX));
}
