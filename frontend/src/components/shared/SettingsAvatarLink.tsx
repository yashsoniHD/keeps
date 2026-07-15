import { Link } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { FOCUS_RING } from "@/lib/ui";
import { cn } from "@/lib/utils";

// Initials from a display name: "Yash Soni" → "YS", "Yash" → "Y". Empty when there's no name,
// which lets the caller fall back to the gear icon instead of a blank circle.
function initials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

// The home/mini-app header's Settings entry, now wearing the user's profile photo. Sized to the
// ICON_BTN geometry (h-10 w-10) with the same hairline border. Calls useAuth itself so header
// call sites stay dumb. The Google avatar URL 403s without referrerPolicy="no-referrer".
export function SettingsAvatarLink({ className }: { className?: string }) {
  const { user } = useAuth();
  const chars = initials(user?.displayName);
  return (
    <Link
      to="/settings"
      aria-label="Settings"
      title="Settings"
      className={cn("inline-flex rounded-full", FOCUS_RING, className)}
    >
      <Avatar className="h-10 w-10 border border-border">
        <AvatarImage src={user?.photoURL ?? undefined} alt="" referrerPolicy="no-referrer" />
        <AvatarFallback className="bg-card text-xs font-medium text-ink-soft">
          {chars || <SettingsIcon className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}
