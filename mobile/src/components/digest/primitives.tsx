import type { ReactNode } from "react";
import { Text, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

// Staggered entry, ported from the web's `reveal()` (fade + slide-up, 700ms, delays keyed per
// child). Only animates when the slide is `active`; inactive/peeking slides render statically so
// they read correctly mid-swipe. The parent remounts its content on each activation (keyed on
// `active`), which replays the entry — matching web's keyed SlideShell.
const DELAYS = [0, 100, 200, 300, 500];

export function Reveal({
  active,
  i = 0,
  style,
  children,
}: {
  active: boolean;
  i?: number;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const delay = DELAYS[Math.min(i, DELAYS.length - 1)];
  return (
    <Animated.View
      style={style}
      entering={active ? FadeInDown.duration(700).delay(delay) : undefined}
    >
      {children}
    </Animated.View>
  );
}

// The small-caps kicker at the top of most slides.
export function Kicker({
  children,
  on,
  active,
  i = 0,
}: {
  children: ReactNode;
  on: string;
  active: boolean;
  i?: number;
}) {
  return (
    <Reveal active={active} i={i}>
      <Text
        className="text-[11px] font-semibold uppercase"
        style={{ color: on, opacity: 0.7, letterSpacing: 1.6 }}
      >
        {children}
      </Text>
    </Reveal>
  );
}
