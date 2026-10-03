// A visible, human-paced cursor for headless recordings: an overlay drawn in the page that follows real mouse
// events, moved from Node along eased curves with short settles before clicks.

export const cursorInitScript = () => {
  const install = () => {
    if (document.getElementById("__cf_cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      html { scrollbar-width: none !important; }
      #__cf_cursor { position: fixed; left: 0; top: 0; width: 26px; height: 32px; z-index: 2147483647; pointer-events: none;
        transform: translate(-100px, -100px); will-change: transform; filter: drop-shadow(0 1.5px 2px rgba(0,0,0,.35)); }
      #__cf_cursor svg { position: absolute; left: 0; top: 0; transition: transform 90ms ease-out; transform-origin: 3px 2px; }
      #__cf_cursor.down svg { transform: scale(0.86); }
      .__cf_ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px; margin: -18px 0 0 -18px;
        border-radius: 50%; background: rgba(46,196,182,.35); border: 2px solid rgba(46,196,182,.85);
        animation: __cf_rip 520ms cubic-bezier(.2,.7,.3,1) forwards; }
      @keyframes __cf_rip { from { transform: scale(.35); opacity: 1 } to { transform: scale(1.5); opacity: 0 } }`;
    document.documentElement.appendChild(style);
    const c = document.createElement("div");
    c.id = "__cf_cursor";
    c.innerHTML = `<svg width="26" height="32" viewBox="0 0 26 32"><path d="M3 2 L3 25 L9 19.5 L13.2 29 L17.4 27.2 L13.3 18 L21.5 18 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(c);
    const pos = window.__cfCursorPos || { x: -100, y: -100 };
    const set = (x, y) => {
      pos.x = x; pos.y = y; window.__cfCursorPos = pos;
      c.style.transform = `translate(${x}px, ${y}px)`;
    };
    set(pos.x, pos.y);
    window.__cfSetCursor = set;
    addEventListener("mousemove", (e) => set(e.clientX, e.clientY), true);
    addEventListener("mousedown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div");
      r.className = "__cf_ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.documentElement) install();
  document.addEventListener("DOMContentLoaded", install);
  // React hydration or a client navigation could remove foreign nodes: re-add
  setInterval(install, 500);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Cursor {
  constructor(page) {
    this.page = page;
    this.x = 960;
    this.y = 600;
  }
  setPage(page) {
    this.page = page;
  }
  async sync() {
    await this.page.mouse.move(this.x, this.y);
    await this.page.evaluate(([x, y]) => window.__cfSetCursor?.(x, y), [this.x, this.y]).catch(() => {});
  }
  /** Move along a gently curved, eased path. Speed ~ 1400 px/s with a 280 ms minimum. */
  async moveTo(x, y, { ms } = {}) {
    const dx = x - this.x, dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const dur = ms ?? Math.min(1100, Math.max(280, dist / 1.4));
    const steps = Math.max(8, Math.round(dur / 16));
    // control point offset perpendicular to the path, for a natural arc
    const bend = Math.min(80, dist * 0.12) * (Math.random() < 0.5 ? -1 : 1);
    const cx = this.x + dx / 2 - (dy / (dist || 1)) * bend;
    const cy = this.y + dy / 2 + (dx / (dist || 1)) * bend;
    const x0 = this.x, y0 = this.y;
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x;
      const py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y;
      await this.page.mouse.move(px, py);
      const target = t0 + (dur * i) / steps;
      const wait = target - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.x = x;
    this.y = y;
  }
  async box(locator) {
    await locator.waitFor({ state: "visible", timeout: 60_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const b = await locator.boundingBox();
    if (!b) throw new Error("no bounding box");
    return b;
  }
  async hover(locator, { settle = 250, fx = 0.5, fy = 0.5 } = {}) {
    const b = await this.box(locator);
    await this.moveTo(b.x + b.width * fx + (Math.random() - 0.5) * Math.min(10, b.width * 0.2), b.y + b.height * fy + (Math.random() - 0.5) * Math.min(4, b.height * 0.2));
    await sleep(settle);
  }
  async click(locator, opts = {}) {
    await this.hover(locator, { settle: opts.settle ?? 280, fx: opts.fx, fy: opts.fy });
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    await sleep(opts.after ?? 350);
  }
  /** Click a field and type at ~12 chars/s. */
  async type(locator, text, { cps = 12, clear = true } = {}) {
    await this.click(locator, { after: 150 });
    if (clear) {
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Backspace");
    }
    await this.page.keyboard.type(text, { delay: 1000 / cps });
    await sleep(250);
  }
  /** Paste-like fill (for long addresses): click, then insert at once, as a person pasting would. */
  async paste(locator, text) {
    await this.click(locator, { after: 150 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.insertText(text);
    await sleep(300);
  }
  /** Smooth wheel scroll by dy pixels over ms. */
  async scroll(dy, ms = 900) {
    const steps = Math.max(10, Math.round(ms / 16));
    let done = 0;
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const target = Math.round(dy * ease(i / steps));
      await this.page.mouse.wheel(0, target - done);
      done = target;
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    await sleep(150);
  }
  /** Smoothly scroll so the locator sits at a fraction of the viewport height. */
  async scrollTo(locator, { at = 0.3, ms } = {}) {
    await locator.waitFor({ state: "attached", timeout: 60_000 });
    const b = await locator.boundingBox();
    if (!b) return;
    const vh = this.page.viewportSize().height;
    const dy = b.y - vh * at;
    if (Math.abs(dy) < 20) return;
    await this.scroll(dy, ms ?? Math.min(1600, Math.max(600, Math.abs(dy) * 0.9)));
  }
}

export { sleep };
