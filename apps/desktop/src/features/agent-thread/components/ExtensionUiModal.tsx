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
  onRespond: (id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
};

function ExtensionUiInline({ requests, onRespond }: Props) {
  const request = requests[requests.length - 1];
  if (request === undefined) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-2">
      <div className="rounded-lg border bg-editor-surface-secondary p-4 shadow-sm">
        {request.method === "select" && (
          <SelectInline request={request as ExtensionUiRequest & { method: "select" }} onRespond={onRespond} />
        )}
        {request.method === "confirm" && (
          <ConfirmInline request={request as ExtensionUiRequest & { method: "confirm" }} onRespond={onRespond} />
        )}
        {request.method === "input" && (
          <InputInline request={request as ExtensionUiRequest & { method: "input" }} onRespond={onRespond} />
        )}
      </div>
    </div>
  );
}

function SelectInline({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest & { method: "select" };
  onRespond: Props["onRespond"];
}) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{request.title}</p>
      <div className="flex flex-wrap gap-2">
        {(request.options ?? []).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={selected === option ? "default" : "outline"}
            onClick={() => setSelected(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onRespond(request.id, { cancelled: true })}>
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
        <Button type="button" variant="ghost" size="sm" onClick={() => onRespond(request.id, { confirmed: false })}>
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
        <Button type="button" variant="ghost" size="sm" onClick={() => onRespond(request.id, { cancelled: true })}>
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
