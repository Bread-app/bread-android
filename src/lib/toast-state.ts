/**
 * The transient banner a sandwich flow shows while it works.
 *
 * Its own module so `lib/sandwich-detail-store.tsx` can type its state without
 * importing `screens/sandwich-screen.tsx` — that import was one half of a
 * runtime import cycle and dragged the whole 14k-line screen into the store's
 * module graph.
 */
export type ToastState = {
  text: string;
  tone: "processing" | "success" | "error";
} | null;
