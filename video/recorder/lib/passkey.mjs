// Chromium virtual WebAuthn authenticator (CTAP2, internal transport, user verification). The passkey credential and
// the browser storage that remembers the passkey account are kept outside the repository (PASSKEY_DIR), so a later
// session can sign in with the same passkey. They belong to a throwaway testnet smart account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PASSKEY_DIR = process.env.CF_PASSKEY_DIR || path.join(os.tmpdir(), "cargoflow-recorder-passkey");
fs.mkdirSync(PASSKEY_DIR, { recursive: true, mode: 0o700 });
const CRED = path.join(PASSKEY_DIR, "credentials.json");
export const PASSKEY_STATE = path.join(PASSKEY_DIR, "storage-state.json");

/**
 * Chromium's virtual authenticator also implements Ed25519 and picks it first when the relying party lists it
 * (ZeroDev's options list -8, -7, -257). Phone and laptop platform authenticators (iCloud Keychain, Google Password
 * Manager) create ES256 passkeys only, which is what the Kernel WebAuthn validator needs. This init script makes the
 * virtual authenticator behave like those: creation requests offer it ES256 only.
 */
export async function es256Only(context) {
  await context.addInitScript(() => {
    const c = navigator.credentials;
    if (!c || !c.create) return;
    const create = c.create.bind(c);
    c.create = (opts) => {
      const pk = opts && opts.publicKey;
      if (pk && Array.isArray(pk.pubKeyCredParams)) {
        const es = pk.pubKeyCredParams.filter((p) => p.alg === -7);
        if (es.length) opts = { ...opts, publicKey: { ...pk, pubKeyCredParams: es } };
      }
      return create(opts);
    };
  });
}

export async function addAuthenticator(page) {
  await es256Only(page.context());
  const s = await page.context().newCDPSession(page);
  await s.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await s.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  if (fs.existsSync(CRED)) {
    for (const credential of JSON.parse(fs.readFileSync(CRED, "utf8"))) await s.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
  return {
    session: s,
    authenticatorId,
    async save() {
      const { credentials } = await s.send("WebAuthn.getCredentials", { authenticatorId });
      fs.writeFileSync(CRED, JSON.stringify(credentials), { mode: 0o600 });
      return credentials.length;
    },
  };
}
