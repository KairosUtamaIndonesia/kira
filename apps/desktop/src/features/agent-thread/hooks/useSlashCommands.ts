import { useMemo } from "react";

import { useSkillsList } from "@/features/skills/hooks/useSkillsList";

import type { ComposerSlashCommand } from "../commands/slashCommands";

type SlashCommandListInput = {
  projectPath?: string;
};

/**
 * Built-in slash commands that are always available. They are listed first in
 * the picker so users discover them before scrolling through per-project
 * Skills. New built-ins get added here.
 */
const builtInSlashCommands: readonly ComposerSlashCommand[] = [
  {
    kind: "built-in",
    name: "compact",
    invocation: "/compact",
    description: "Manually compact this Agent Thread's context",
    dispatch: () => ({ type: "action", action: "compact" }),
  },
];

/**
 * Returns the slash commands visible in the Composer. Built-in commands come
 * first so users discover them; Skills follow, with project Skills after
 * bundled Skills. Future command sources (custom commands, extensions) plug
 * in here.
 */
function useSlashCommands(input: SlashCommandListInput): ComposerSlashCommand[] {
  const { state } = useSkillsList(input.projectPath);
  return useMemo<ComposerSlashCommand[]>(() => {
    if (state.status !== "ready") {
      return [...builtInSlashCommands];
    }
    const { bundled, project } = state.result;
    const commands: ComposerSlashCommand[] = [...builtInSlashCommands];
    for (const skill of [...bundled, ...project]) {
      if (skill.conflict) {
        continue;
      }
      commands.push({
        kind: "skill",
        name: skill.name,
        invocation: `/skill:${skill.name}`,
        description: skill.description,
        dispatch: () => ({
          type: "insert",
          text: `<skill name="${skill.name}" />`,
        }),
      });
    }
    return commands;
  }, [state]);
}

export { useSlashCommands };
export type { SlashCommandListInput, ComposerSlashCommand };
