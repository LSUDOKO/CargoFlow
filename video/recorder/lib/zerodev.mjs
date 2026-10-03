// ZeroDev traffic of a page (passkey server, bundler, paymaster), logged without the project URL.
/** Log ZeroDev bundler/paymaster/passkey-server traffic without printing the project URL. */
export function watchZeroDev(page, log) {
  page.on("response", async (res) => {
    const u = res.url();
    if (!/zerodev\.app/.test(u)) return;
    const req = res.request();
    let method = "";
    try { const b = JSON.parse(req.postData() || "{}"); method = Array.isArray(b) ? b.map((x) => x.method).join(",") : b.method || ""; } catch {}
    let body = "";
    try { body = (await res.text()).replace(/\s+/g, " "); } catch {}
    const host = new URL(u).host;
    const tail = new URL(u).pathname.split("/").slice(-2).join("/");
    log.push({ t: new Date().toISOString().slice(11, 19), host, tail: host.startsWith("passkeys") ? tail : "", method, status: res.status(), body: body.slice(0, 3000) });
  });
}
