import type { ComponentType } from "react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";
import type { RespondToHumanRequest } from "../../types";

import { AgentThreadToolAskUser } from "./AgentThreadToolAskUser";
import { AgentThreadToolBash } from "./AgentThreadToolBash";
import { AgentThreadToolDefault } from "./AgentThreadToolDefault";
import { AgentThreadToolEdit } from "./AgentThreadToolEdit";
import { AgentThreadToolGlob } from "./AgentThreadToolGlob";
import { AgentThreadToolGrep } from "./AgentThreadToolGrep";
import { AgentThreadToolLs } from "./AgentThreadToolLs";
import { AgentThreadToolMemory } from "./AgentThreadToolMemory";
import { AgentThreadToolMemorySearch } from "./AgentThreadToolMemorySearch";
import { AgentThreadToolRead } from "./AgentThreadToolRead";
import { AgentThreadToolSessionSearch } from "./AgentThreadToolSessionSearch";
import { AgentThreadToolSkill } from "./AgentThreadToolSkill";
import { AgentThreadToolTask } from "./AgentThreadToolTask";
import { AgentThreadToolWrite } from "./AgentThreadToolWrite";

type ToolComponentProps = {
  tool: AgentThreadToolCallDisplay;
  respond: RespondToHumanRequest;
};
type ToolComponent = ComponentType<ToolComponentProps>;

const toolComponents: Record<string, ToolComponent> = {
  read: AgentThreadToolRead,
  write: AgentThreadToolWrite,
  edit: AgentThreadToolEdit,
  bash: AgentThreadToolBash,
  grep: AgentThreadToolGrep,
  find: AgentThreadToolGlob,
  glob: AgentThreadToolGlob,
  ls: AgentThreadToolLs,
  task: AgentThreadToolTask,
  ask_user: AgentThreadToolAskUser,
  memory: AgentThreadToolMemory,
  memory_search: AgentThreadToolMemorySearch,
  session_search: AgentThreadToolSessionSearch,
  skill: AgentThreadToolSkill,
};

function toolComponentForName(name: string): ToolComponent {
  return toolComponents[name] ?? AgentThreadToolDefault;
}

export { toolComponentForName };
export { AgentThreadToolDefault } from "./AgentThreadToolDefault";
