import { ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import type {
  GuardrailsCommandPattern,
  GuardrailsConfig,
  GuardrailsPolicyRule,
  GuardrailsProtection,
} from "@/features/settings/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useGuardrailsSettings } from "@/features/settings/guardrailsSettings";

type Segment = "policies" | "commands";

const PROTECTION_LABELS: Record<GuardrailsProtection, string> = {
  none: "No protection",
  readOnly: "Read only",
  noAccess: "No access",
};

function GuardrailsSettings() {
  const { config, status, updateConfig } = useGuardrailsSettings();
  const [segment, setSegment] = useState<Segment>("policies");

  if (config === undefined) {
    return (
      <section className="rounded-xl border border-border bg-card text-card-foreground">
        <div className="p-4 text-sm text-muted-foreground">
          {status === "error"
            ? "Guardrails settings failed to load."
            : "Loading guardrails settings…"}
        </div>
      </section>
    );
  }

  const commit = useCallback(
    (next: GuardrailsConfig) => {
      void updateConfig(next);
    },
    [updateConfig],
  );

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-4 border-b border-border p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Guardrails
          </h2>
          <p className="text-xs text-muted-foreground">
            Protect sensitive files and gate dangerous commands. When off, no checks run.
          </p>
        </div>
        <Switch
          aria-label="Enable guardrails"
          checked={config.enabled}
          onCheckedChange={(checked) => commit({ ...config, enabled: checked })}
        />
      </div>

      <div className="grid gap-4 p-4">
        <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
          <Button
            size="sm"
            variant={segment === "policies" ? "secondary" : "ghost"}
            onClick={() => setSegment("policies")}
          >
            File policies
          </Button>
          <Button
            size="sm"
            variant={segment === "commands" ? "secondary" : "ghost"}
            onClick={() => setSegment("commands")}
          >
            Command gate
          </Button>
        </div>

        {segment === "policies" ? (
          <FilePoliciesPanel config={config} onCommit={commit} />
        ) : (
          <CommandGatePanel config={config} onCommit={commit} />
        )}
      </div>
    </section>
  );
}

type PanelProps = {
  config: GuardrailsConfig;
  onCommit: (next: GuardrailsConfig) => void;
};

function FilePoliciesPanel({ config, onCommit }: PanelProps) {
  const disabled = !config.enabled || !config.features.policies;
  const rules = config.policies.rules;

  function setRules(next: GuardrailsPolicyRule[]) {
    onCommit({ ...config, policies: { rules: next } });
  }

  return (
    <div className="grid gap-4">
      <ToggleRow
        label="File protection"
        description="Block reads and writes to protected file paths."
        checked={config.features.policies}
        disabled={!config.enabled}
        onCheckedChange={(checked) =>
          onCommit({ ...config, features: { ...config.features, policies: checked } })
        }
      />

      <p className="text-xs text-muted-foreground">
        Built-in protections (always active): secret files, private keys, SSH keys, and git
        configuration.
      </p>

      <div className="grid gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Custom rules
        </p>
        <EditableList
          items={rules}
          getKey={(rule) => rule.id}
          emptyLabel="No custom rules."
          disabled={disabled}
          renderItem={(rule) => (
            <>
              <span className="font-mono text-xs">{rule.id}</span>
              <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                {rule.patterns.join(", ")}
              </span>
              <Select
                value={rule.protection}
                onValueChange={(value) =>
                  setRules(
                    rules.map((current) =>
                      current.id === rule.id
                        ? { ...current, protection: value as GuardrailsProtection }
                        : current,
                    ),
                  )
                }
              >
                <SelectTrigger size="sm" className="w-32" disabled={disabled}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No protection</SelectItem>
                  <SelectItem value="readOnly">Read only</SelectItem>
                  <SelectItem value="noAccess">No access</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          onRemove={(rule) => setRules(rules.filter((current) => current.id !== rule.id))}
        />
        <AddRuleForm
          disabled={disabled}
          existingIds={rules.map((rule) => rule.id)}
          onAdd={(rule) => setRules([...rules, rule])}
        />
      </div>
    </div>
  );
}

function CommandGatePanel({ config, onCommit }: PanelProps) {
  const gate = config.permissionGate;
  const disabled = !config.enabled || !config.features.permissionGate;

  function setGate(next: GuardrailsConfig["permissionGate"]) {
    onCommit({ ...config, permissionGate: next });
  }

  return (
    <div className="grid gap-4">
      <ToggleRow
        label="Command gate"
        description="Prompt or block dangerous shell commands."
        checked={config.features.permissionGate}
        disabled={!config.enabled}
        onCheckedChange={(checked) =>
          onCommit({ ...config, features: { ...config.features, permissionGate: checked } })
        }
      />
      <ToggleRow
        label="Use built-in matchers"
        description="Detect rm -rf, sudo, dd, mkfs, and similar commands structurally."
        checked={gate.useBuiltinMatchers}
        disabled={disabled}
        onCheckedChange={(checked) => setGate({ ...gate, useBuiltinMatchers: checked })}
      />
      <ToggleRow
        label="Confirm before running"
        description="Prompt for approval when a command matches; otherwise allow it."
        checked={gate.requireConfirmation}
        disabled={disabled}
        onCheckedChange={(checked) => setGate({ ...gate, requireConfirmation: checked })}
      />

      <CommandPatternEditor
        patterns={gate.patterns}
        disabled={disabled}
        onChange={(next) => setGate({ ...gate, patterns: next })}
      />
      <StringListEditor
        label="Always allowed"
        description="Commands containing these substrings bypass the gate."
        items={gate.allowedPatterns}
        placeholder="rm -rf node_modules"
        disabled={disabled}
        onChange={(next) => setGate({ ...gate, allowedPatterns: next })}
      />
      <StringListEditor
        label="Always denied"
        description="Commands containing these substrings are blocked without a prompt."
        items={gate.autoDenyPatterns}
        placeholder="rm -rf /"
        disabled={disabled}
        onChange={(next) => setGate({ ...gate, autoDenyPatterns: next })}
      />
    </div>
  );
}

type ToggleRowProps = {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function ToggleRow({ label, description, checked, disabled, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

type EditableListProps<T> = {
  items: readonly T[];
  renderItem: (item: T) => React.ReactNode;
  getKey: (item: T) => string;
  onRemove: (item: T) => void;
  disabled: boolean;
  emptyLabel: string;
};

function EditableList<T>({
  items,
  renderItem,
  getKey,
  onRemove,
  disabled,
  emptyLabel,
}: EditableListProps<T>) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <li
          key={getKey(item)}
          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
        >
          {renderItem(item)}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove ${getKey(item)}`}
            disabled={disabled}
            onClick={() => onRemove(item)}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}

type AddRuleFormProps = {
  disabled: boolean;
  existingIds: string[];
  onAdd: (rule: GuardrailsPolicyRule) => void;
};

function AddRuleForm({ disabled, existingIds, onAdd }: AddRuleFormProps) {
  const [id, setId] = useState("");
  const [patterns, setPatterns] = useState("");
  const [protection, setProtection] = useState<GuardrailsProtection>("noAccess");

  const trimmedId = id.trim();
  const parsedPatterns = patterns
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  const canAdd =
    !disabled &&
    trimmedId.length > 0 &&
    parsedPatterns.length > 0 &&
    !existingIds.includes(trimmedId);

  function add() {
    if (!canAdd) {
      return;
    }

    onAdd({ id: trimmedId, patterns: parsedPatterns, protection });
    setId("");
    setPatterns("");
    setProtection("noAccess");
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        className="w-32"
        placeholder="rule id"
        value={id}
        disabled={disabled}
        onChange={(event) => setId(event.target.value)}
      />
      <Input
        className="flex-1"
        placeholder="patterns, comma separated"
        value={patterns}
        disabled={disabled}
        onChange={(event) => setPatterns(event.target.value)}
      />
      <Select
        value={protection}
        onValueChange={(value) => setProtection(value as GuardrailsProtection)}
      >
        <SelectTrigger size="sm" className="w-32" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{PROTECTION_LABELS.none}</SelectItem>
          <SelectItem value="readOnly">{PROTECTION_LABELS.readOnly}</SelectItem>
          <SelectItem value="noAccess">{PROTECTION_LABELS.noAccess}</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={!canAdd} onClick={add}>
        Add
      </Button>
    </div>
  );
}

type CommandPatternEditorProps = {
  patterns: GuardrailsCommandPattern[];
  disabled: boolean;
  onChange: (next: GuardrailsCommandPattern[]) => void;
};

function CommandPatternEditor({ patterns, disabled, onChange }: CommandPatternEditorProps) {
  const [pattern, setPattern] = useState("");
  const [description, setDescription] = useState("");

  const trimmedPattern = pattern.trim();
  const canAdd =
    !disabled &&
    trimmedPattern.length > 0 &&
    !patterns.some((entry) => entry.pattern === trimmedPattern);

  function add() {
    if (!canAdd) {
      return;
    }

    const trimmedDescription = description.trim();
    onChange([
      ...patterns,
      {
        pattern: trimmedPattern,
        description: trimmedDescription.length > 0 ? trimmedDescription : trimmedPattern,
      },
    ]);
    setPattern("");
    setDescription("");
  }

  return (
    <div className="grid gap-2">
      <div className="space-y-0.5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Custom patterns
        </p>
        <p className="text-xs text-muted-foreground">
          Commands containing these substrings trigger a prompt.
        </p>
      </div>
      <EditableList
        items={patterns}
        getKey={(entry) => entry.pattern}
        emptyLabel="No custom patterns."
        disabled={disabled}
        renderItem={(entry) => (
          <>
            <span className="font-mono text-xs">{entry.pattern}</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {entry.description}
            </span>
          </>
        )}
        onRemove={(entry) =>
          onChange(patterns.filter((current) => current.pattern !== entry.pattern))
        }
      />
      <div className="flex items-center gap-2">
        <Input
          className="w-48"
          placeholder="pattern substring"
          value={pattern}
          disabled={disabled}
          onChange={(event) => setPattern(event.target.value)}
        />
        <Input
          className="flex-1"
          placeholder="description (optional)"
          value={description}
          disabled={disabled}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={!canAdd} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

type StringListEditorProps = {
  label: string;
  description: string;
  items: string[];
  placeholder: string;
  disabled: boolean;
  onChange: (next: string[]) => void;
};

function StringListEditor({
  label,
  description,
  items,
  placeholder,
  disabled,
  onChange,
}: StringListEditorProps) {
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const canAdd = !disabled && trimmed.length > 0 && !items.includes(trimmed);

  function add() {
    if (!canAdd) {
      return;
    }

    onChange([...items, trimmed]);
    setDraft("");
  }

  return (
    <div className="grid gap-2">
      <div className="space-y-0.5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <EditableList
        items={items}
        getKey={(item) => item}
        emptyLabel="None."
        disabled={disabled}
        renderItem={(item) => <span className="flex-1 truncate font-mono text-xs">{item}</span>}
        onRemove={(item) => onChange(items.filter((current) => current !== item))}
      />
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={!canAdd} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

export { GuardrailsSettings };
