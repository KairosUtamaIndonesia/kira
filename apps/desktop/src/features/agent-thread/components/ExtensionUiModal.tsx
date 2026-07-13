/**
 * ExtensionUiModal — renders extension UI prompts inline within the thread panel.
 *
 * Renders as a card between the transcript and composer, scoped to the thread.
 * Not a portal dialog — does not interrupt other threads.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { ExtensionUiRequest } from "../hooks/useAgentThreadConnection";

type Props = {
  requests: ExtensionUiRequest[];
  onRespond: (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ) => void;
};

function ExtensionUiInline({ requests, onRespond }: Props) {
  const request = requests[requests.length - 1];
  if (request === undefined) return undefined; // eslint-disable-line unicorn/no-useless-undefined

  return (
    <div className="mx-auto w-full max-w-6xl px-2">
      <div className="bg-editor-surface-secondary rounded-lg border p-4 shadow-sm">
        {request.method === "select" && (
          <SelectInline
            request={request as ExtensionUiRequest & { method: "select" }}
            onRespond={onRespond}
          />
        )}
        {request.method === "confirm" && (
          <ConfirmInline
            request={request as ExtensionUiRequest & { method: "confirm" }}
            onRespond={onRespond}
          />
        )}
        {request.method === "input" && (
          <InputInline
            request={request as ExtensionUiRequest & { method: "input" }}
            onRespond={onRespond}
          />
        )}
      </div>
    </div>
  );
}

interface ParsedOption {
  index: number;
  fullText: string;
  label: string;
  description: string;
  hasPreview: boolean;
  isSentinel: boolean;
}

function parseOptions(options: string[]): ParsedOption[] {
  const result: ParsedOption[] = [];
  for (const text of options) {
    // Sentinel: "N. Type something."
    const sentinelMatch = text.match(/^(\d+)\.\s+(Type something\.)$/);
    if (sentinelMatch) {
      result.push({
        index: Number.parseInt(sentinelMatch[1] as string, 10) - 1,
        fullText: text,
        label: "Type something.",
        description: "",
        hasPreview: false,
        isSentinel: true,
      });
      continue;
    }

    // Normal option: "N. Label - Description[ [Preview]]"
    // Uses non-greedy label match to stop at the first " - " separator
    const m = text.match(/^(\d+)\.\s+(.+?)\s+-\s+(.+)$/);
    if (!m) continue;

    const index = Number.parseInt(m[1] as string, 10) - 1;
    const label = m[2] as string;
    let description = m[3] as string;
    const hasPreview = description.endsWith(" [Preview]");
    if (hasPreview) {
      description = description.slice(0, -" [Preview]".length);
    }
    result.push({ index, fullText: text, label, description, hasPreview, isSentinel: false });
  }
  return result;
}

function SelectInline({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest & { method: "select" };
  onRespond: Props["onRespond"];
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const [customValue, setCustomValue] = useState("");
  const parsedOptions = parseOptions(request.options ?? []);

  const hasSentinel = parsedOptions.some((o) => o.isSentinel);
  const normalOptions = parsedOptions.filter((o) => !o.isSentinel);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{request.title}</p>
      <div className="flex flex-wrap gap-2">
        {normalOptions.map((opt) => (
          <Button
            key={opt.fullText}
            type="button"
            size="sm"
            variant={selected === opt.fullText ? "default" : "outline"}
            onClick={() => setSelected(opt.fullText)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {hasSentinel ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Or type a custom answer:</p>
          <div className="flex gap-2">
            <Input
              placeholder="Type your answer..."
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customValue.length > 0) {
                  onRespond(request.id, { value: customValue });
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={customValue.length === 0}
              onClick={() => onRespond(request.id, { value: customValue })}
            >
              Submit
            </Button>
          </div>
        </div>
      ) : undefined}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRespond(request.id, { cancelled: true })}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={selected === undefined}
          onClick={() => {
            if (selected !== undefined) onRespond(request.id, { value: selected });
          }}
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}

function ConfirmInline({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest & { method: "confirm" };
  onRespond: Props["onRespond"];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{request.title}</p>
      {request.message !== undefined && (
        <p className="text-sm text-muted-foreground">{request.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRespond(request.id, { confirmed: false })}
        >
          No
        </Button>
        <Button type="button" size="sm" onClick={() => onRespond(request.id, { confirmed: true })}>
          Yes
        </Button>
      </div>
    </div>
  );
}

function InputInline({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest & { method: "input" };
  onRespond: Props["onRespond"];
}) {
  const [value, setValue] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{request.title}</p>
      <Input
        placeholder={request.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.length > 0) {
            onRespond(request.id, { value });
          }
        }}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRespond(request.id, { cancelled: true })}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={value.length === 0}
          onClick={() => onRespond(request.id, { value })}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

export { ExtensionUiInline };
