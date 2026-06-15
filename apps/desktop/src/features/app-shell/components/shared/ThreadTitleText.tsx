import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";

import { cn } from "@/lib/utils";

type TextSwapPhase = "idle" | "exit" | "enter-start";

type ThreadTitleTextProps = {
  className?: string;
  isGenerating: boolean;
  text: string;
};

const textSwapDurationMs = 150;

function ThreadTitleText({ className, isGenerating, text }: ThreadTitleTextProps) {
  const [element, setElement] = useState<HTMLSpanElement>();
  const [displayText, setDisplayText] = useState(text);
  const [phase, setPhase] = useState<TextSwapPhase>("idle");
  const latestTextRef = useRef(text);
  const timeoutRef = useRef<number | undefined>(void 0);
  const frameRef = useRef<number | undefined>(void 0);

  const setTitleElement = useCallback<RefCallback<HTMLSpanElement>>((node) => {
    if (node instanceof HTMLSpanElement) {
      setElement(node);
    }
  }, []);

  useEffect(() => {
    if (text === latestTextRef.current) {
      return;
    }

    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
    }
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
    }

    if (element === undefined) {
      latestTextRef.current = text;
      setDisplayText(text);
      setPhase("idle");
      return;
    }

    setPhase("exit");
    timeoutRef.current = window.setTimeout(() => {
      latestTextRef.current = text;
      setDisplayText(text);
      setPhase("enter-start");
      frameRef.current = window.requestAnimationFrame(() => {
        void element.offsetHeight;
        setPhase("idle");
      });
    }, textSwapDurationMs);
  }, [element, text]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <span
      ref={setTitleElement}
      className={cn(
        "kira-text-swap truncate",
        isGenerating ? "kira-shimmer" : undefined,
        phase === "exit" ? "is-exit" : undefined,
        phase === "enter-start" ? "is-enter-start" : undefined,
        className,
      )}
      data-text={displayText}
    >
      {displayText}
    </span>
  );
}

export { ThreadTitleText };
