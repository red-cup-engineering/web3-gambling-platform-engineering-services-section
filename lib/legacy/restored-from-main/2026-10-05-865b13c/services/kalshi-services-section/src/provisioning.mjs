import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createKalshiClient, kalshiCredentials, kalshiEnvFile } from './client.mjs';
import { generateEd25519KeyPair } from './signing.mjs';

/**
 * Putting a Kalshi API key in the signer host's custody, with the person at
 * the node in the assisted browser (the custodian office's
 * keeping-venue-account-custody duty).
 *
 * The account is the founder's own (KYC, Google sign-in); only its own
 * authority registers a key. So the node makes an Ed25519 key pair, keeps
 * the private half (0600, outside the repository), and the person registers
 * the public half on Kalshi's profile page and pastes back the Key ID, which
 * is not a secret. The private key never leaves the node and is never shown.
 * If the person instead lets Kalshi make the key, they paste the private key
 * Kalshi shows once into the panel's secret field and it goes straight to
 * the key file. Either way the key is checked by a signed balance read
 * before the env file names it, and the receipt holds no secret.
 */
export const KEY_NAME = 'house-weather-desk';
export const keyPath = (env = process.env) => env.KALSHI_PRIVATE_KEY_PATH ?? join(env.HOME ?? homedir(), '.config', '561-group', 'keys', 'kalshi', `${KEY_NAME}.pem`);
const KEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PEM_PATTERN = /-----BEGIN ((?:RSA |EC )?PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----/u;
const PROFILE = 'https://kalshi.com/account/profile';
const stopped = () => Object.assign(new Error('the person stopped provisioning'), { code: 'PROVISION_STOPPED' });

async function writePrivate(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode: 0o600, flag: 'w' });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/** A private key PEM as pasted into a one-line field: newlines may be gone, so the body is rewrapped. */
export function normalizePrivateKeyPem(pasted) {
  const match = PEM_PATTERN.exec(String(pasted ?? ''));
  if (!match) return null;
  const body = match[2].replace(/\s+/gu, '').match(/.{1,64}/gu).join('\n');
  const pem = `-----BEGIN ${match[1]}-----\n${body}\n-----END ${match[1]}-----\n`;
  try { createPrivateKey(pem); return pem; } catch { return null; }
}

/** The node's key pair: the one already in custody, or a new Ed25519 pair written there now. */
export async function custodyKeyPair(path = keyPath()) {
  let privateKeyPem;
  try { privateKeyPem = await readFile(path, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    privateKeyPem = generateEd25519KeyPair().privateKeyPem;
    await writePrivate(path, privateKeyPem);
  }
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' });
  const fingerprint = createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { path, privateKeyPem, publicKeyPem, fingerprint };
}

/** Whether a key id and private key sign in: a signed balance read, outcome only. */
export async function checkKey({ apiKeyId, privateKeyPem }, { fetchImpl } = {}) {
  try {
    const balance = await createKalshiClient({ credentials: { apiKeyId, privateKeyPem }, fetchImpl }).getBalance();
    return { ok: true, balanceDollars: balance.balance_dollars ?? (balance.balance / 100).toFixed(2) };
  } catch (error) {
    if (error.status === 401 || error.status === 403) return { ok: false, reason: `Kalshi refused it (${error.status}): the Key ID and the registered key do not match` };
    return { ok: false, reason: `Kalshi could not be reached to check it (${error.code})` };
  }
}

async function writeEnvFile(path, { apiKeyId, keyFile }) {
  await writePrivate(path, `# Kalshi API key in the signer host's custody (provision-kalshi-api-key); no secret here.\nKALSHI_API_KEY_ID=${apiKeyId}\nKALSHI_PRIVATE_KEY_PATH=${keyFile}\n`);
}

/**
 * Provision the desk's key: already in custody and signing in, or obtained
 * through the person now. Resolves with a receipt naming the key id, key
 * file and fingerprint, and the balance the check read.
 */
export async function provisionApiKey({ env = process.env, notify } = {}, capabilities = {}) {
  const fetchImpl = capabilities.fetch;
  const existing = kalshiCredentials(env);
  if (existing) {
    const checked = await checkKey(existing, { fetchImpl });
    if (checked.ok) return { type: 'KalshiApiKeyCustody', apiKeyId: existing.apiKeyId, already: true, balanceDollars: checked.balanceDollars, at: new Date().toISOString() };
  }
  const pair = await custodyKeyPair(keyPath(env));
  const { openAccount } = capabilities.openAccount ? { openAccount: capabilities.openAccount } : await import('@red-cup-engineering/assisted-browser-services-section/accounts');
  const { stepGuide } = capabilities.stepGuide ? { stepGuide: capabilities.stepGuide } : await import('@red-cup-engineering/assisted-browser-services-section/assist');
  const { context, page, close } = await openAccount('kalshi', { visible: true, notify }, capabilities.browser ?? {});
  try {
    if (!page.url().startsWith(PROFILE)) await page.goto(PROFILE, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    const guide = await stepGuide(context, { notify });
    for (let refusal = ''; ;) {
      const answer = await guide.show(
        `${refusal}Give the house's weather desk an API key on your Kalshi account.\n\n` +
        '1. Sign in if Kalshi asks (Continue with Google).\n' +
        '2. On Profile, under API Keys, choose Create New API Key and use your own public key: paste the public key below and name it as below. If it offers access levels, allow reading and trading only.\n' +
        '3. Paste the Key ID Kalshi shows here.\n\n' +
        'If Kalshi only offers to make the key itself, let it, and choose "Kalshi made the key".',
        {
          values: [{ label: 'Key name', value: KEY_NAME }, { label: 'Public key (Ed25519)', value: pair.publicKeyPem.trim() }],
          labels: ['Use this Key ID', 'Kalshi made the key', 'Stop'],
          input: { label: 'Key ID', pattern: KEY_ID_PATTERN, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
        },
      );
      if (answer.label === 'Stop') throw stopped();
      let credentials = { apiKeyId: answer.value, privateKeyPem: pair.privateKeyPem }, keyFile = pair.path;
      if (answer.label === 'Kalshi made the key') {
        const keyId = await guide.show('Paste the Key ID Kalshi shows for the key it made.', { labels: ['Next', 'Stop'], input: { label: 'Key ID', pattern: KEY_ID_PATTERN } });
        if (keyId.label !== 'Next') throw stopped();
        const secret = await guide.show('Paste the private key Kalshi shows (it shows it once; the downloaded .txt holds the same text). It goes straight to the node\'s key file and is never shown again.', {
          labels: ['Use this key', 'Stop'], input: { label: 'Private key (-----BEGIN … PRIVATE KEY-----)', pattern: PEM_PATTERN, secret: true },
        });
        if (secret.label !== 'Use this key') throw stopped();
        const pem = normalizePrivateKeyPem(secret.value);
        if (!pem) { refusal = 'That was not used: the pasted text is not a private key.\n\n'; continue; }
        keyFile = keyPath(env).replace(/\.pem$/u, '.venue-made.pem');
        credentials = { apiKeyId: keyId.value, privateKeyPem: pem };
        await writePrivate(keyFile, pem);
      }
      const checked = await checkKey(credentials, { fetchImpl });
      if (!checked.ok) { refusal = `That was not used: ${checked.reason}.\n\n`; continue; }
      await writeEnvFile(kalshiEnvFile(env), { apiKeyId: credentials.apiKeyId, keyFile });
      await guide.show(`Done: the desk's key signs in. Balance read: $${checked.balanceDollars}. This window closes in a minute.`, { labels: ['Close'], timeout: 60_000 }).catch(() => {});
      return { type: 'KalshiApiKeyCustody', apiKeyId: credentials.apiKeyId, keyFile, fingerprint: keyFile === pair.path ? pair.fingerprint : null, envFile: kalshiEnvFile(env), balanceDollars: checked.balanceDollars, at: new Date().toISOString() };
    }
  } catch (error) {
    if (error?.code === 'PROVISION_STOPPED') return { type: 'KalshiApiKeyCustody', stoppedEarly: true, at: new Date().toISOString() };
    throw error;
  } finally {
    await close();
  }
}
