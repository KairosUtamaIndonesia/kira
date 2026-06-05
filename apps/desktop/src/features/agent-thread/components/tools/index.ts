import type { ComponentType } from "react";

import type { AgentThreadToolCallDisplay } from "../../agentThreadDisplay";

import { AgentThreadToolBash } from "./AgentThreadToolBash";
import { AgentThreadToolDefault } from "./AgentThreadToolDefault";
import { AgentThreadToolEdit } from "./AgentThreadToolEdit";
import { AgentThreadToolGlob } from "./AgentThreadToolGlob";
import { AgentThreadToolGrep } from "./AgentThreadToolGrep";
import { AgentThreadToolRead } from "./AgentThreadToolRead";
import { AgentThreadToolTask } from "./AgentThreadToolTask";
import { AgentThreadToolWrite } from "./AgentThreadToolWrite";

type ToolComponent = ComponentType<{ tool: AgentThreadToolCallDisplay }>;

const toolComponents: Record<string, ToolComponent> = {
  read: AgentThreadToolRead,
  write: AgentThreadToolWrite,
  edit: AgentThreadToolEdit,
  bash: AgentThreadToolBash,
  grep: AgentThreadToolGrep,
  glob: AgentThreadToolGlob,
  task: AgentThreadToolTask,
};

function toolComponentForName(name: string): ToolComponent {
  return toolComponents[name] ?? AgentThreadToolDefault;
}

export { toolComponentForName };
export { AgentThreadToolDefault } from "./AgentThreadToolDefault";