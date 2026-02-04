import { useEffect } from "react";

type GlobalErrorPayload = {
  message: string;
  stack?: string;
  source: "error" | "unhandledrejection";
  timestamp: string;
};

const STORAGE_KEY = "neon-global-errors";
const MAX_ERRORS = 20;

const recordError = (payload: GlobalErrorPayload) => {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const parsed = existing ? (JSON.parse(existing) as GlobalErrorPayload[]) : [];
    const next = [payload, ...parsed].slice(0, MAX_ERRORS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("Failed to persist global error:", err);
  }
};

export const useGlobalErrorCapture = () => {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || "Unknown window error";
      recordError({
        message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        source: "error",
        timestamp: new Date().toISOString(),
      });
      console.error("Window error captured:", event.error || event.message);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      recordError({
        message: reason.message || "Unhandled rejection",
        stack: reason.stack,
        source: "unhandledrejection",
        timestamp: new Date().toISOString(),
      });
      console.error("Unhandled rejection captured:", reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
};
