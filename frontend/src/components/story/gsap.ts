"use client";

/*
 * GSAP for the landing page only (free incl. ScrollTrigger since 3.13). Imported by client components that are
 * rendered on "/", so Next splits it into that route's chunk and no other page downloads it.
 */
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export { gsap, ScrollTrigger, useGSAP };

/** Media conditions shared by every landing animation. */
export const MOTION = "(prefers-reduced-motion: no-preference)";
export const REDUCED = "(prefers-reduced-motion: reduce)";
