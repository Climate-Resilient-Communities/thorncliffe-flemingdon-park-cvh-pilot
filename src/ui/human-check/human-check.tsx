"use client";
// The human check's widget on the text sign-up and place suggestion forms (session 2, #2 and #12; src/platform/humanCheck.ts).
// Rendered only when the page gives a site key, which it does only while the check is on. Cloudflare Turnstile in its
// "interaction-only" appearance: most residents see nothing and tap nothing; a resident it is unsure of sees one checkbox. Its
// token is single use, so the form calls `reset` after every answer that is not a success.
import { useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_SCRIPT } from "@/contracts/humanCheck";

interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_ID = "cvh-human-check";

/** Loads Cloudflare's script once per page, and resolves when `window.turnstile` is there. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"))));
    script.addEventListener("error", () => reject(new Error("turnstile")));
  });
}

/** The form's side of the check: the latest token (null until there is one), and `reset` after a refused or failed send. */
export function useHumanCheck() {
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setRound((r) => r + 1);
  }, []);
  return { token, setToken, round, reset };
}

export function HumanCheck({ siteKey, round, onToken }: { siteKey: string | null; round: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    const container = box.current;
    loadTurnstile()
      .then((turnstile) => {
        if (gone) return;
        widget.current = turnstile.render(container, {
          sitekey: siteKey,
          appearance: "interaction-only",
          language: "auto",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      // Cloudflare could not be reached: the form still sends, without a token, and the server says why if it refuses.
      .catch(() => undefined);
    return () => {
      gone = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (round > 0 && widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [round]);

  if (!siteKey) return null;
  return <div ref={box} className="human-check" data-testid="human-check" />;
}
