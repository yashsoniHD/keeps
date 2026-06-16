import { logEvent } from "firebase/analytics";
import { analyticsReady } from "@/integrations/firebase/client";

function track(event: string, params?: Record<string, string | number | boolean>) {
  analyticsReady.then((a) => {
    if (a) logEvent(a, event, params);
  });
}

export const analytics = {
  noteSaved: (contentType?: string) =>
    track("note_saved", contentType ? { content_type: contentType } : undefined),
  noteViewed: (contentType: string) =>
    track("note_viewed", { content_type: contentType }),
  askSubmitted: () =>
    track("ask_submitted"),
};
