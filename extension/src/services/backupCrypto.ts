import * as crypto from 'crypto';

// ── Backup encryption (scrypt + AES-256-GCM) ──────────────────────
export interface EncryptedBundle {
  format: 'envstash-encrypted';
  v: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: { name: 'aes-256-gcm'; iv: string; tag: string };
  data: string;
}

const ENC_FORMAT = 'envstash-encrypted';
const SCRYPT = { N: 1 << 15, r: 8, p: 1 };
export const MIN_PASSPHRASE = 8;

export function isEncryptedBundle(value: unknown): value is EncryptedBundle {
  return (value as EncryptedBundle | null)?.format === ENC_FORMAT;
}

function deriveKey(pass: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pass.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 256 * N * r * p },
      (err, key) => err ? reject(err) : resolve(key));
  });
}

export async function encryptBundle(json: string, pass: string): Promise<EncryptedBundle> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(pass, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return {
    format: ENC_FORMAT, v: 1,
    kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64'),
  };
}

export async function decryptBundle(enc: EncryptedBundle, pass: string): Promise<string> {
  const { N, r, p, salt } = enc.kdf ?? ({} as EncryptedBundle['kdf']);
  // Cost parameters come from the file, so bound them before spending memory on them
  const okParams = enc.v === 1 && enc.kdf?.name === 'scrypt' && enc.cipher?.name === 'aes-256-gcm'
    && Number.isInteger(N) && N >= (1 << 14) && N <= (1 << 17) && (N & (N - 1)) === 0 && r === 8 && p === 1;
  if (!okParams) throw new Error('Unsupported encrypted backup format');
  try {
    const key = await deriveKey(pass, Buffer.from(salt, 'base64'), N, r, p);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.cipher.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(enc.cipher.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Wrong passphrase or corrupted backup file');
  }
}
