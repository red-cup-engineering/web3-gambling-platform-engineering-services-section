// Kalshi trade-API request signing. The pre-sign text is
// `${timestampMs}${METHOD}${path}` (path without query), sent as
// KALSHI-ACCESS-KEY / KALSHI-ACCESS-SIGNATURE / KALSHI-ACCESS-TIMESTAMP.
// Kalshi picks the verification algorithm from the registered public key, so
// the signer follows the parsed private key: Ed25519 signs the text directly,
// RSA uses PSS with SHA-256 and a digest-length salt. The PEM header does not
// tell the two apart (PKCS#8 RSA also reads BEGIN PRIVATE KEY).
// Pure and side-effect-free so callers that only need to sign a request
// (rather than the full client, which reads config files at load time) can
// import this directly.
import { constants, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

export function signRequest({ privateKeyPem, timestampMs, method, path }) {
  const key = createPrivateKey(privateKeyPem);
  const text = Buffer.from(`${timestampMs}${method.toUpperCase()}${path}`, 'utf8');
  if (key.asymmetricKeyType === 'ed25519') return sign(null, text, key).toString('base64');
  if (key.asymmetricKeyType === 'rsa') {
    return sign('sha256', text, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }).toString('base64');
  }
  throw new TypeError(`kalshi signing: unsupported key type ${key.asymmetricKeyType}`);
}

export function authHeaders({ apiKeyId, privateKeyPem, method, path, timestampMs = Date.now() }) {
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signRequest({ privateKeyPem, timestampMs, method, path }),
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

/** A fresh Ed25519 key pair as PEM strings: Kalshi's recommended key type, registered by its public half so the private half never leaves the signer host. */
export function generateEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}
