import { Boxes, ChevronRight, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { BundledSource, InstalledSkill, SkillScope } from "../types";

import { useSkillsList } from "../hooks/useSkillsList";

type SkillsInspectorProps = {
  folderPath: string | undefined;
  onOpenSkill: (skill: InstalledSkill) => void;
};

type SectionConfig = {
  scope: SkillScope;
  title: string;
  caption: string;
};

const sectionConfigs: SectionConfig[] = [
  { scope: "bundled", title: "Bundled", caption: "ships with Kira" },
  { scope: "project", title: "Project", caption: "discovered for agent" },
  { scope: "global", title: "Global", caption: "not loaded by Kira's agent" },
];

function SkillsInspector({ folderPath, onOpenSkill }: SkillsInspectorProps) {
  const { state, refresh } = useSkillsList(folderPath);
  const [filterQuery, setFilterQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<SkillScope, boolean>>({
    bundled: false,
    project: false,
    global: false,
  });

  const normalizedFilter = filterQuery.trim().toLowerCase();

  const scopedSkills = useMemo<Record<SkillScope, InstalledSkill[]>>(() => {
    if (state.status !== "ready") {
      return { bundled: [], project: [], global: [] };
    }

    const matches = (skill: InstalledSkill) =>
      normalizedFilter.length === 0 ||
      skill.name.toLowerCase().includes(normalizedFilter) ||
      skill.description.toLowerCase().includes(normalizedFilter);

    return {
      bundled: state.result.bundled.filter(matches),
      project: state.result.project.filter(matches),
      global: state.result.global.filter(matches),
    };
  }, [normalizedFilter, state]);

  if (state.status === "idle" || state.status === "loading") {
    return <EmptyState message="Loading skills…" />;
  }

  if (state.status === "error") {
    return <EmptyState message={state.message} role="alert" />;
  }

  const bundledSource = state.result.bundledSource;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">Skills</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh skills"
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          value={filterQuery}
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter skills…"
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="min-h-0 flex-1 scrollbar-sleek divide-y divide-border overflow-auto">
        {sectionConfigs.map((config) => (
          <SkillsSection
            key={config.scope}
            config={config}
            skills={scopedSkills[config.scope]}
            isCollapsed={collapsed[config.scope]}
            onToggle={() =>
              setCollapsed((current) => ({
                ...current,
                [config.scope]: !current[config.scope],
              }))
            }
            emptyMessage={sectionEmptyMessage(
              config.scope,
              folderPath,
              bundledSource,
              normalizedFilter,
              filterQuery,
            )}
            onOpenSkill={onOpenSkill}
          />
        ))}
      </div>
    </div>
  );
}

type SkillsSectionProps = {
  config: SectionConfig;
  skills: InstalledSkill[];
  isCollapsed: boolean;
  onToggle: () => void;
  emptyMessage: string;
  onOpenSkill: (skill: InstalledSkill) => void;
};

function SkillsSection({
  config,
  skills,
  isCollapsed,
  onToggle,
  emptyMessage,
  onOpenSkill,
}: SkillsSectionProps) {
  return (
    <section>
      <button
        type="button"
        className="sticky top-0 z-10 flex w-full items-center gap-2 bg-card px-3 py-2 text-left hover:bg-accent/50"
        aria-expanded={!isCollapsed}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !isCollapsed && "rotate-90",
          )}
        />
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {config.title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">({skills.length})</span>
        <span className="ml-auto truncate text-xs text-muted-foreground/70">{config.caption}</span>
      </button>
      <div
        aria-hidden={isCollapsed}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-150 ease-out",
          isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {skills.length === 0 ? (
            <EmptyState message={emptyMessage} />
          ) : (
            <ul className="pb-2">
              {skills.map((skill) => (
                <SkillRow
                  key={`${skill.scope}:${skill.name}`}
                  skill={skill}
                  onOpenSkill={onOpenSkill}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

type SkillRowProps = {
  skill: InstalledSkill;
  onOpenSkill: (skill: InstalledSkill) => void;
};

function SkillRow({ skill, onOpenSkill }: SkillRowProps) {
  const isOpenable = skill.scope === "project" && skill.skillPath !== null;
  const provenance = provenanceLabel(skill);
  const content = (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
        {skill.conflict ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-destructive">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            conflict
          </span>
        ) : undefined}
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
      {provenance !== undefined ? (
        <p className="truncate text-[11px] text-muted-foreground/70">{provenance}</p>
      ) : undefined}
    </>
  );
  if (isOpenable) {
    return (
      <li>
        <button
          type="button"
          className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent/50"
          onClick={() => onOpenSkill(skill)}
        >
          {content}
        </button>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-col gap-1 px-3 py-2.5", skill.scope === "global" && "opacity-80")}>
      {content}
    </li>
  );
}

function provenanceLabel(skill: InstalledSkill): string | undefined {
  if (skill.source !== null) {
    return `${skill.sourceType ?? "source"} · ${skill.source}`;
  }
  return undefined;
}

function sectionEmptyMessage(
  scope: SkillScope,
  folderPath: string | undefined,
  bundledSource: BundledSource,
  normalizedFilter: string,
  filterQuery: string,
): string {
  if (normalizedFilter.length > 0) {
    return `No skills match "${filterQuery}".`;
  }

  if (scope === "bundled") {
    return bundledSource.kind === "runtimeUnavailable"
      ? "Runtime unavailable — bundled skills can't be listed."
      : "Kira's agent bundles no skills yet.";
  }

  if (scope === "project") {
    return folderPath === undefined
      ? "Open a Project to see its skills."
      : "No skills installed in this Project.";
  }

  return "No global skills installed.";
}

function EmptyState({ message, role }: { message: string; role?: "alert" }) {
  return (
    <div role={role} className="px-3 py-2 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export { SkillsInspector };
