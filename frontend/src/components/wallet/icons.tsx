// Icons for the wallet picker. Installed wallets bring their own icon (EIP-6963 announces it as a data URI);
// these cover the methods that have no announced icon.

const tile = "grid h-10 w-10 shrink-0 place-items-center rounded-xl";

/** The official WalletConnect mark on its blue tile. */
export function WalletConnectIcon() {
  return (
    <span className={`${tile} bg-[#3396FF]`} aria-hidden="true">
      <svg viewBox="0 0 300 185" className="h-[15px] w-6" fill="#fff">
        <path d="M61.44 36.26c48.91-47.89 128.21-47.89 177.12 0l5.89 5.76a6.04 6.04 0 0 1 0 8.67l-20.14 19.72a3.18 3.18 0 0 1-4.43 0l-8.1-7.93c-34.12-33.41-89.44-33.41-123.56 0l-8.68 8.5a3.18 3.18 0 0 1-4.43 0L54.98 51.25a6.04 6.04 0 0 1 0-8.67l6.46-6.32Zm218.77 40.77 17.92 17.55a6.04 6.04 0 0 1 0 8.67l-80.81 79.12a6.36 6.36 0 0 1-8.86 0l-57.36-56.15a1.59 1.59 0 0 0-2.21 0l-57.36 56.15a6.36 6.36 0 0 1-8.86 0L1.87 103.25a6.04 6.04 0 0 1 0-8.67l17.92-17.55a6.36 6.36 0 0 1 8.86 0l57.36 56.15a1.59 1.59 0 0 0 2.21 0l57.35-56.15a6.36 6.36 0 0 1 8.86 0l57.36 56.15a1.59 1.59 0 0 0 2.21 0l57.35-56.15a6.36 6.36 0 0 1 8.86 0Z" />
      </svg>
    </span>
  );
}

export function MailIcon() {
  return (
    <span className={`${tile} bg-signal text-ink`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    </span>
  );
}

/** A browser wallet that did not announce itself (legacy window.ethereum). */
export function GenericWalletIcon() {
  return (
    <span className={`${tile} bg-ink text-signal`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 5.5" />
        <circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/** Local test accounts (end-to-end builds only). */
export function TestAccountIcon() {
  return (
    <span className={`${tile} bg-mist text-ink`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6M10 3v6l-5 8.5A2 2 0 0 0 6.7 20.5h10.6a2 2 0 0 0 1.7-3L14 9V3" />
        <path d="M7.5 15h9" />
      </svg>
    </span>
  );
}

export function PuzzleIcon() {
  return (
    <span className={`${tile} border-2 border-dashed border-line bg-white text-slate`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4.5Z" />
      </svg>
    </span>
  );
}

/** The wallet's own announced icon, framed like the others. */
export function AnnouncedIcon({ src }: { src: string }) {
  return (
    <span className={`${tile} overflow-hidden bg-white ring-1 ring-ink/8`} aria-hidden="true">
      {/* data: URIs from the wallet extension; next/image cannot optimise these */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-8 w-8 object-contain" draggable={false} />
    </span>
  );
}
