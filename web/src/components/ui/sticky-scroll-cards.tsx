"use client";

import "lenis/dist/lenis.css";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import ReactLenis from "lenis/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// Adapted from Componentry's Sticky Scroll Cards (componentry.dev/r/sticky-scroll-cards): the
// cards hold content rather than remote photos, so nothing is fetched from a third party, and
// they render as a list on the deck top-plate finish.

export interface StickyScrollCardItem {
  /** Unique key */
  id: string;
  /** Card content */
  content: React.ReactNode;
}

interface StickyScrollCardsProps {
  /** Cards in reading order; each later card stacks over the one before. */
  cards: StickyScrollCardItem[];
  /** Optional hint printed above the stack */
  hint?: string;
  /** Classes for the list */
  className?: string;
  /** Classes for each card face */
  cardClassName?: string;
}

const TILT_PATTERN = [-1.25, 0.85, -0.65, 1.35, -0.9];

function StackCard({
  card,
  index,
  total,
  progress,
  reduceMotion,
  className,
}: {
  card: StickyScrollCardItem;
  index: number;
  total: number;
  progress: MotionValue<number>;
  reduceMotion: boolean;
  className?: string;
}) {
  // Each card starts shrinking once it is pinned, so earlier cards settle smaller behind later ones.
  const start = total > 1 ? index / (total + 1) : 0;
  const restingScale = Math.max(0.56, 1 - (total - index - 1) * 0.095);
  const scale = useTransform(progress, [start, 1], reduceMotion ? [1, 1] : [1, restingScale]);

  return (
    <div role="listitem" className="sticky top-0 grid h-dvh w-full place-items-center px-4">
      <motion.div
        className={cn("panel plate-screws relative w-[min(100%,620px)] origin-top", className)}
        style={{
          scale,
          rotate: reduceMotion ? 0 : TILT_PATTERN[index % TILT_PATTERN.length],
          // Later cards sit a little lower, so the top edges of the ones behind stay in view.
          top: `${index * 22 - 24}px`,
          boxShadow: "inset 0 1px 0 var(--key-highlight), var(--elev-lift)",
        }}
      >
        {card.content}
      </motion.div>
    </div>
  );
}

/**
 * Cards that pin to the middle of the window one after another and shrink back into a stack
 * as the page scrolls, with Lenis smoothing the scroll. With reduced motion the cards stack
 * without scaling or tilt, and native scrolling is left alone.
 */
export function StickyScrollCards({ cards, hint, className, cardClassName }: StickyScrollCardsProps) {
  const container = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: container, offset: ["start start", "end end"] });

  const content = (
    <div className="relative">
      {hint ? (
        <div aria-hidden className="flex flex-col items-center gap-3 pt-2">
          <p className="text-eyebrow text-muted">{hint}</p>
          <span className="h-12 w-px bg-gradient-to-b from-muted to-transparent" />
        </div>
      ) : null}
      {/* A list role on a plain box, so the trailing spacer can sit inside it: sticky cards only stay
          pinned within their parent, and padding there would let them scroll away early. Clipping
          (not hiding) the tilted corners keeps phones from scrolling sideways without breaking sticky. */}
      <div ref={container} role="list" className={cn("relative flex w-full flex-col items-center overflow-x-clip", className)}>
        {cards.map((card, index) => (
          <StackCard
            key={card.id}
            card={card}
            index={index}
            total={cards.length}
            progress={scrollYProgress}
            reduceMotion={reduceMotion}
            className={cardClassName}
          />
        ))}
        <div aria-hidden className="h-[50vh]" />
      </div>
    </div>
  );

  return reduceMotion ? content : <ReactLenis root>{content}</ReactLenis>;
}
