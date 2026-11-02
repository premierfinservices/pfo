/**
 * The motion the GST and ITR summary needs that CSS alone cannot do: counting
 * a figure up to its new value, and letting the old graph sink before the new
 * one rises. Everything here is skipped, not shortened, when the person has
 * asked their system for reduced motion.
 */

import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A number that rolls from where it is to `target`. Whole rupees while it
 * moves, and exactly `target` (paise included) when it lands, so the figure on
 * screen is never an approximation once it has settled. Starts from 0 on first
 * show.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (prefersReducedMotion() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const origin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = progress >= 1 ? target : Math.round(origin + (target - origin) * eased);
      from.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return shown;
}

/**
 * Holds what a graph is drawing. When `signature` changes, `leaving` is true
 * for `outMs` (the old bars sink), then `shown` becomes the new target and
 * `version` goes up, which remounts the bars so they rise from the baseline.
 * `signature` must change whenever the drawn content would.
 */
export function useStaged<T>(
  target: T,
  signature: string,
  outMs = 240,
): { readonly shown: T; readonly leaving: boolean; readonly version: number } {
  const [state, setState] = useState({ shown: target, leaving: false, version: 0 });
  const seen = useRef(signature);
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    if (prefersReducedMotion()) {
      setState((s) => ({ shown: latest.current, leaving: false, version: s.version + 1 }));
      return;
    }
    setState((s) => ({ ...s, leaving: true }));
    const timer = setTimeout(
      () => setState((s) => ({ shown: latest.current, leaving: false, version: s.version + 1 })),
      outMs,
    );
    return () => clearTimeout(timer);
  }, [signature, outMs]);

  return state;
}

/** True for a moment after `token` changes. Never on first show. */
export function useFlashOnChange(token: unknown, forMs = 1400): boolean {
  const [flashing, setFlashing] = useState(false);
  const previous = useRef(token);

  useEffect(() => {
    if (previous.current === token) return;
    previous.current = token;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), forMs);
    return () => clearTimeout(timer);
  }, [token, forMs]);

  return flashing;
}
