// CDP screencast -> constant 30 fps H.264 take. The latest JPEG frame is written to ffmpeg on a wall-clock schedule,
// so the take is CFR and in real time even though Chromium only emits frames when the page changes.
import { spawn } from "node:child_process";

const FPS = 30;

export class Capture {
  constructor(file) {
    this.file = file;
    this.marks = [];
    this.latest = null;
    this.session = null;
    this.written = 0;
  }
  async attach(page) {
    if (this.session) {
      await this.session.send("Page.stopScreencast").catch(() => {});
      await this.session.detach().catch(() => {});
    }
    const s = await page.context().newCDPSession(page);
    this.session = s;
    s.on("Page.screencastFrame", (f) => {
      if (this.session !== s) return;
      this.latest = Buffer.from(f.data, "base64");
      s.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await s.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    // force a first frame
    await page.evaluate(() => window.scrollBy(0, 0)).catch(() => {});
  }
  async start(page) {
    await this.attach(page);
    const t = Date.now();
    while (!this.latest && Date.now() - t < 5000) await new Promise((r) => setTimeout(r, 20));
    this.ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-r", String(FPS), this.file], { stdio: ["pipe", "inherit", "inherit"] });
    this.t0 = Date.now();
    this.written = 0;
    this.timer = setInterval(() => this.pump(), 8);
  }
  pump() {
    if (!this.latest || this.writing) return;
    const due = Math.floor(((Date.now() - this.t0) / 1000) * FPS) + 1;
    if (due <= this.written) return;
    this.writing = true;
    const n = due - this.written;
    let ok = true;
    for (let i = 0; i < n; i++) ok = this.ff.stdin.write(this.latest) && ok;
    this.written = due;
    if (ok) this.writing = false;
    else this.ff.stdin.once("drain", () => (this.writing = false));
  }
  /** Seconds since the take started. */
  now() {
    return (Date.now() - this.t0) / 1000;
  }
  mark(name) {
    const t = this.now();
    this.marks.push({ name, t: Number(t.toFixed(3)) });
    console.log(`  [${t.toFixed(2)}s] ${name}`);
    return t;
  }
  async stop() {
    clearInterval(this.timer);
    this.pump();
    const durationSec = this.now();
    await this.session?.send("Page.stopScreencast").catch(() => {});
    await new Promise((res) => {
      this.ff.on("close", res);
      this.ff.stdin.end();
    });
    return { file: this.file, marks: this.marks, durationSec };
  }
}
