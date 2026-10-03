"use client";

/*
 * Every GSAP effect on the landing page, loaded lazily (see Fx.tsx): the components render their markup without
 * GSAP, and this module, with gsap and ScrollTrigger, arrives after hydration and only on "/". Each setup receives
 * the component's root element and returns its cleanup; MotionFx runs it inside useGSAP, which reverts everything
 * it created on unmount.
 */
import { gsap, MOTION, REDUCED, ScrollTrigger } from "./gsap";
import { animSpan, ENTER, formatCount, parseCount, stepAt, stepScrollY } from "./steps";

/** Pin only where there is room for the stage and a caption on one screen. */
const PIN = `${MOTION} and (min-height: 620px)`;

/**
 * Adds an element animation, declared on the server-rendered scene with data-a / data-at / data-d, to a timeline.
 * Scenes are drawn in their final state, so every tween animates *from* a start state to what is already there.
 */
function addSceneAnims(tl: gsap.core.Timeline, scene: Element, step: number) {
  scene.querySelectorAll<SVGElement>("[data-a]").forEach((el) => {
    const d = el.dataset;
    const { position, duration } = animSpan(step, Number(d.at ?? 0), Number(d.d ?? 0.3));
    const x = Number(d.x ?? 0);
    const y = Number(d.y ?? 0);
    switch (d.a) {
      case "draw": {
        const len = el instanceof SVGGeometryElement ? el.getTotalLength() : 0;
        if (!len) break;
        // keep a dotted connector dotted: draw it with a mask-like offset on top of its own dash pattern
        const dashed = el.getAttribute("stroke-dasharray");
        if (dashed) tl.fromTo(el, { opacity: 0 }, { opacity: 0.55, duration, ease: "none" }, position);
        else tl.fromTo(el, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration, ease: "none" }, position);
        break;
      }
      case "pop":
        tl.from(el, { scale: 0.3, opacity: 0, transformOrigin: "50% 50%", duration, ease: "back.out(1.7)" }, position);
        break;
      case "drop":
        tl.from(el, { y: -48, opacity: 0, duration, ease: "power2.out" }, position);
        break;
      case "rise":
        tl.from(el, { y: 18, opacity: 0, duration, ease: "power2.out" }, position);
        break;
      case "fade":
        tl.from(el, { opacity: 0, duration, ease: "none" }, position);
        break;
      case "slide":
        tl.from(el, { x, y, opacity: 0, duration, ease: "power2.inOut" }, position);
        break;
      case "leave":
        tl.fromTo(el, { x: 0, y: 0, opacity: 1 }, { x, y, opacity: 0, duration, ease: "power2.in" }, position);
        break;
      case "count": {
        // remember the final figure the server printed: a re-run (resize, Strict Mode) must not read a mid-count value
        if (d.to === undefined) d.to = String(parseCount(el.textContent ?? ""));
        const to = Number(d.to);
        const from = Number(d.from ?? 0);
        const dec = Number(d.dec ?? 0);
        if (Number.isNaN(to)) break;
        const box = { v: from };
        el.textContent = formatCount(from, dec);
        tl.fromTo(box, { v: from }, { v: to, duration, ease: "power1.out", onUpdate: () => void (el.textContent = formatCount(box.v, dec)) }, position);
        break;
      }
    }
  });
}

/** Puts every counted figure back to its final value (when a layout's animations are torn down). */
function restoreCounts(root: Element) {
  root.querySelectorAll<SVGElement>("[data-a='count'][data-to]").forEach((el) => {
    el.textContent = formatCount(Number(el.dataset.to), Number(el.dataset.dec ?? 0));
  });
}

/**
 * The scroll story. On screens tall enough it pins the stage and scrubs one timeline through the six steps
 * (captions and scenes cross-fade, each scene's objects animate in); on short screens each step plays as it scrolls
 * into view; under reduced motion steps simply fade in, unpinned. Without JavaScript the stacked layout shows every
 * step in its final state.
 */
function story(el: HTMLElement) {
  let trigger: ScrollTrigger | null = null;
  const steps = Array.from(el.querySelectorAll<HTMLElement>("[data-story-step]"));
  const n = steps.length;
  const caps = steps.map((st) => st.querySelector<HTMLElement>("[data-story-cap]")!);
  const scenes = steps.map((st) => st.querySelector<HTMLElement>("[data-story-scene]")!);
  const links = Array.from(el.querySelectorAll<HTMLAnchorElement>("[data-story-goto]"));
  const setActive = (k: number) => {
    if (el.dataset.active === String(k)) return;
    el.dataset.active = String(k);
    links.forEach((a, i) => (i === k ? a.setAttribute("aria-current", "step") : a.removeAttribute("aria-current")));
  };
  const mm = gsap.matchMedia();

  mm.add({ pin: PIN, reduce: REDUCED }, (ctx) => {
    const { pin, reduce } = ctx.conditions as { pin: boolean; reduce: boolean };
    if (pin) {
      const top = () => document.querySelector("header")?.getBoundingClientRect().height ?? 64;
      el.style.setProperty("--story-top", `${top()}px`);
      el.dataset.mode = "pin";
      setActive(0);
      const pinEl = el.querySelector<HTMLElement>("[data-story-pin]")!;
      const bar = el.querySelector<HTMLElement>("[data-story-bar]");
      gsap.set([...caps.slice(1), ...scenes.slice(1)], { opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "none" } });
      if (bar) tl.fromTo(bar, { scaleX: 1 / n }, { scaleX: 1, duration: n - 1, ease: "none", transformOrigin: "0 50%" }, 0.5);
      steps.forEach((_, i) => {
        if (i > 0) {
          tl.to([caps[i - 1], scenes[i - 1]], { opacity: 0, duration: ENTER }, i);
          tl.fromTo(caps[i]!, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: ENTER, ease: "power2.out" }, i);
          tl.fromTo(scenes[i]!, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: ENTER, ease: "power2.out" }, i);
        }
        addSceneAnims(tl, scenes[i]!, i);
      });
      tl.set({}, {}, n);
      trigger = ScrollTrigger.create({
        trigger: pinEl,
        start: () => `top ${top()}px`,
        end: () => `+=${Math.round(n * window.innerHeight * 0.8)}`,
        pin: true,
        scrub: 0.6,
        animation: tl,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefresh: () => el.style.setProperty("--story-top", `${top()}px`),
        onUpdate: (self) => setActive(stepAt(self.progress, n)),
      });
      return () => {
        restoreCounts(el);
        trigger = null;
        delete el.dataset.mode;
        delete el.dataset.active;
        links.forEach((a) => a.removeAttribute("aria-current"));
      };
    }
    if (reduce) {
      steps.forEach((st) => {
        gsap.from(st, { opacity: 0, duration: 0.5, ease: "none", scrollTrigger: { trigger: st, start: "top 88%", once: true } });
      });
      return;
    }
    // short screens with motion: each step plays once as it enters
    steps.forEach((st, i) => {
      const tl = gsap.timeline({ paused: true });
      addSceneAnims(tl, scenes[i]!, i);
      tl.from([caps[i], scenes[i]], { opacity: 0, y: 20, duration: ENTER, ease: "power2.out" }, i);
      tl.timeScale(0.35);
      tl.seek(i);
      ScrollTrigger.create({ trigger: st, start: "top 78%", once: true, onEnter: () => void tl.play() });
    });
    return () => restoreCounts(el);
  });

  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("[data-story-goto]");
    const st = trigger;
    if (!a || !st || el.dataset.mode !== "pin") return;
    e.preventDefault();
    const k = Number(a.dataset.storyGoto);
    window.scrollTo({ top: stepScrollY(st.start, st.end, k, n), behavior: window.matchMedia(REDUCED).matches ? "auto" : "smooth" });
  };
  el.addEventListener("click", onClick);
  return () => {
    el.removeEventListener("click", onClick);
    mm.revert();
  };
}

/** Staggers `[data-reveal]` children in as the block scrolls into view (desktop, motion allowed). */
function reveal(el: HTMLElement, o: { media?: string; stagger?: number }) {
  const mm = gsap.matchMedia();
  mm.add(o.media ?? `${MOTION} and (min-width: 1024px)`, () => {
    const items = el.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    gsap.from(items, { y: 48, opacity: 0, duration: 0.8, ease: "power3.out", stagger: o.stagger ?? 0.09, scrollTrigger: { trigger: el, start: "top 78%", once: true } });
  });
  return () => mm.revert();
}

/** A slow vertical drift of a framed image while its frame scrolls past. */
function parallax(el: HTMLElement, o: { distance?: number }) {
  const d = o.distance ?? 7;
  const mm = gsap.matchMedia();
  mm.add(MOTION, () => {
    if (!el.parentElement) return;
    gsap.fromTo(el, { yPercent: -d / 2 }, { yPercent: d / 2, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
  });
  return () => mm.revert();
}

const whole = (v: number) => Math.round(v).toLocaleString();

/** A whole number that counts up from zero the first time it is seen, then eases to each new value. */
function count(el: HTMLElement, o: { value?: number }) {
  const value = o.value ?? 0;
  const mm = gsap.matchMedia();
  mm.add(MOTION, () => {
    const seen = el.dataset.shown !== undefined;
    const box = { v: seen ? Number(el.dataset.shown) : 0 };
    const run = () =>
      gsap.to(box, {
        v: value,
        duration: seen ? 0.6 : 1.4,
        ease: "power2.out",
        onUpdate: () => void (el.textContent = whole(box.v)),
        onComplete: () => void (el.dataset.shown = String(value)),
      });
    if (seen) return void run();
    el.textContent = whole(0);
    ScrollTrigger.create({ trigger: el, start: "top 92%", once: true, onEnter: () => void run() });
    return () => {
      // torn down mid-count: show the real figure
      el.textContent = whole(value);
    };
  });
  return () => mm.revert();
}

export const SETUPS = { story, reveal, parallax, count } as const;
export type FxKind = keyof typeof SETUPS;
