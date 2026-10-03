// Configuration for passkey smart accounts (ZeroDev Kernel v3.1 + the WebAuthn validator, ERC-4337 EntryPoint v0.7)
// on Robinhood Chain Testnet. Everything here is read at build time; with no project id the feature does not exist.
//
// Verified on chain 46630: EntryPoint v0.7 0x0000000071727De22E5E9d8BAf0edAc6f37da032, Kernel v3.1 meta factory
// 0xd703aaE79538628d27099B8c4f621bE4CCd142d5 (factory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419), Kernel v3.1
// implementation 0xbAC849bB641841b44E965fB01A4Bf5F074f84b4D, WebAuthn validator 0.0.3
// 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69, and the RIP-7212 P-256 precompile at 0x100.

export const ZERODEV_PROJECT_ID = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

/** The only chain passkey accounts run on. */
export const PASSKEY_CHAIN_ID = 46630;

export const PASSKEY_CONNECTOR_ID = "cargoflow-passkey";

const zerodevV3 = (id: string) => `https://rpc.zerodev.app/api/v3/${id}/chain/${PASSKEY_CHAIN_ID}`;

/** ZeroDev's v3 RPC answers both the bundler and the paymaster (zd_sponsorUserOperation) methods for the project. */
export const BUNDLER_URL = process.env.NEXT_PUBLIC_ZERODEV_BUNDLER_URL || (ZERODEV_PROJECT_ID ? zerodevV3(ZERODEV_PROJECT_ID) : "");
export const PAYMASTER_URL = process.env.NEXT_PUBLIC_ZERODEV_PAYMASTER_URL || (ZERODEV_PROJECT_ID ? zerodevV3(ZERODEV_PROJECT_ID) : "");

/**
 * ZeroDev's hosted passkey server for the project. The URL shape is the one the ZeroDev dashboard shows and the
 * official tutorial uses (https://github.com/zerodevapp/passkey-tutorial, app/page.tsx: PASSKEY_SERVER_URL =
 * "https://passkeys.zerodev.app/api/v3/<projectId>"); @zerodev/webauthn-key calls its /register/options,
 * /register/verify, /login/options and /login/verify (docs: https://docs.zerodev.app/onboarding/passkeys/overview).
 * The project's allowed domain must be set in the dashboard for deployed origins (empty for localhost).
 */
export const PASSKEY_SERVER_URL =
  process.env.NEXT_PUBLIC_ZERODEV_PASSKEY_SERVER_URL || (ZERODEV_PROJECT_ID ? `https://passkeys.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}` : "");

export const PASSKEYS_ENABLED = !!ZERODEV_PROJECT_ID;
