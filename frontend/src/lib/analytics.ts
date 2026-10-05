import { logEvent } from "firebase/analytics";
import { analyticsReady } from "@/integrations/firebase/client";

function track(event: string, params?: Record<string, string | number | boolean>) {
  analyticsReady.then((a) => {
    if (a) logEvent(a, event, params);
  });
}

// Fire a funnel milestone only once per browser, ever. The localStorage flag is a
// best-effort dedupe — analytics is non-critical, so a storage failure just means the
// event may fire again, which is acceptable for a funnel signal.
function trackOnce(key: string, event: string, params?: Record<string, string | number | boolean>) {
  try {
    const k = `keeps.ev.${key}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch {
    /* storage disabled — fall through and fire anyway */
  }
  track(event, params);
}

export const analytics = {
  // Acquisition: a brand-new account was created (fired on first sign-in only).
  signUp: (method = "google", ref?: string) => track("sign_up", ref ? { method, ref } : { method }),
  // Activation funnel: first capture attempt → first note actually rendered.
  firstCapture: () => trackOnce("first_capture", "first_capture"),
  noteSaved: (contentType?: string) =>
    track("note_saved", contentType ? { content_type: contentType } : undefined),
  activated: () => trackOnce("activated", "activated"),
  noteViewed: (contentType: string) => track("note_viewed", { content_type: contentType }),
  // Engagement: every ask, plus a one-time "user discovered Clip AI" milestone.
  askSubmitted: () => track("ask_submitted"),
  clipAiUsed: () => trackOnce("clip_ai_used", "clip_ai_used"),
  // Retention: first app open on a calendar day later than the previous visit.
  returned: () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const last = localStorage.getItem("keeps.lastActiveDay");
      if (last && last !== today) track("returned");
      if (last !== today) localStorage.setItem("keeps.lastActiveDay", today);
    } catch {
      /* storage disabled — skip the returned signal */
    }
  },
};
