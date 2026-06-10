import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { ElementCapturePayload } from "../types";

import { formatElementCapture } from "../captureFormat";
import { AgentThreadPicker } from "./AgentThreadPicker";

type ElementCaptureSheetProps = {
  payload: ElementCapturePayload | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendToThread: (threadId: string, text: string) => void;
};

// Result surface for a captured element. The Sheet portal trips the browser overlay gate, so
// the native webview hides while this is open and the sheet renders unobstructed. Offers a
// clipboard copy and a thread picker that seeds the chosen Agent Thread's Composer.
function ElementCaptureSheet({
  payload,
  open,
  onOpenChange,
  onSendToThread,
}: ElementCaptureSheetProps) {
  const formatted = useMemo(
    () => (payload === undefined ? "" : formatElementCapture(payload)),
    [payload],
  );
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy to the clipboard.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[28rem] max-w-[90vw] gap-0">
        <SheetHeader>
          <SheetTitle>Captured element</SheetTitle>
          <SheetDescription>
            {payload === undefined
              ? ""
              : `<${payload.target.tagName}> on ${payload.pageContext.title || payload.pageContext.url}`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4">
          <pre className="rounded-sm border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-foreground">
            {formatted}
          </pre>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">Send to Agent Thread</h3>
            <AgentThreadPicker onSelect={(threadId) => onSendToThread(threadId, formatted)} />
          </div>
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyToClipboard()}
            disabled={payload === undefined}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export { ElementCaptureSheet };
