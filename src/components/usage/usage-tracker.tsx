"use client";
/**
 * Records page views, clicks, dropdown choices, which fields were edited (not
 * their contents), forms given up on, and errors. Mounted once per window.
 */
import { usePathname } from "next/navigation";
import * as React from "react";
import { flushUsage, routeOf, track } from "@/lib/usage-client";

interface FormState {
  name: string;
  start: number;
  form: HTMLFormElement;
}

function labelOf(el: Element): string {
  const own = el.getAttribute("data-track") ?? el.getAttribute("aria-label") ?? el.getAttribute("title");
  if (own) return own;
  if (el instanceof HTMLAnchorElement) return `link ${routeOf(new URL(el.href, window.location.href).pathname)}`;
  return (el.textContent ?? "").trim() || el.tagName.toLowerCase();
}

function fieldName(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const byLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
  return el.getAttribute("aria-label") ?? byLabel ?? el.name ?? el.type;
}

function formName(form: HTMLFormElement): string {
  return form.getAttribute("data-track") ?? form.getAttribute("aria-label") ?? `form on ${routeOf(window.location.pathname)}`;
}

export function UsageTracker() {
  const pathname = usePathname();
  const entered = React.useRef<{ path: string; at: number } | null>(null);
  const forms = React.useRef(new Map<HTMLFormElement, FormState>());

  const abandonForms = React.useCallback((all: boolean) => {
    for (const [form, s] of forms.current) {
      if (all || !form.isConnected) {
        track("abandon", s.name, { ms: Date.now() - s.start });
        forms.current.delete(form);
      }
    }
  }, []);

  // Page views, with time spent on the page that was left.
  React.useEffect(() => {
    const now = Date.now();
    const prev = entered.current;
    // Under 300 ms is a redirect or a dev-mode double mount, not a visit.
    if (prev && now - prev.at >= 300) {
      track("view", prev.path, { ms: now - prev.at });
      abandonForms(true);
    }
    entered.current = { path: routeOf(pathname), at: now };
  }, [pathname, abandonForms]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest("button, a, [role=button], [role=tab], [role=menuitem], summary");
      if (el) track("click", labelOf(el));
    };
    const onChange = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLSelectElement) {
        const v = el.value;
        track("select", fieldName(el), v.length <= 40 ? { meta: { value: v } } : {});
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Which field changed, never what is in it.
        if (el.type !== "hidden") track("edit", fieldName(el), { meta: { type: el.type } });
      }
    };
    const onInput = (e: Event) => {
      const form = (e.target as Element | null)?.closest?.("form");
      if (form && !forms.current.has(form)) forms.current.set(form, { name: formName(form), start: Date.now(), form });
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      const s = forms.current.get(form);
      track("submit", s?.name ?? formName(form), s ? { ms: Date.now() - s.start } : {});
      forms.current.delete(form);
    };
    const onError = (e: ErrorEvent) => track("error", String(e.message || "Script error"));
    const onRejection = (e: PromiseRejectionEvent) => track("error", String((e.reason as Error)?.message ?? e.reason ?? "Rejected promise"));
    const onHide = () => {
      if (document.visibilityState === "hidden") flushUsage(true);
    };
    const onLeave = () => {
      const prev = entered.current;
      if (prev) track("view", prev.path, { ms: Date.now() - prev.at });
      entered.current = null;
      abandonForms(true);
      flushUsage(true);
    };
    const sweep = window.setInterval(() => abandonForms(false), 5000);

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(sweep);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [abandonForms]);

  return null;
}
