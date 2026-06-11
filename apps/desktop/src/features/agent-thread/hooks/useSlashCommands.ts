import { useMemo } from "react";

import { useSkillsList } from "@/features/skills/hooks/useSkillsList";

import type { ComposerSlashCommand } from "../commands/slashCommands";

type SlashCommandListInput = {
  projectPath?: string;
};

/**
 * Returns the slash commands visible in the Composer. Skills are the only
 * source for now; future command sources (custom commands, extensions) plug
 * in here.
 */
function useSlashCommands(input: SlashCommandListInput): ComposerSlashCommand[] {
  const { state } = useSkillsList(input.projectPath);
  return useMemo<ComposerSlashCommand[]>(() => {
    if (state.status !== "ready") {
      return [];
    }
    const { bundled, project } = state.result;
    const commands: ComposerSlashCommand[] = [];
    for (const skill of [...bundled, ...project]) {
      if (skill.conflict) {
        continue;
      }
      commands.push({
        kind: "skill",
        name: skill.name,
        invocation: `/skill:${skill.name}`,
        description: skill.description,
        expand: () => `<skill name="${skill.name}" />`,
      });
    }
    return commands;
  }, [state]);
}

export { useSlashCommands };
export type { SlashCommandListInput, ComposerSlashCommand };
