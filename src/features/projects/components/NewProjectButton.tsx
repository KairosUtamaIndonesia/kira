import { Plus } from "lucide-react";
import { useState } from "react";

import { SidebarGroupAction } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { CreatedProject } from "../types";

import { NewProjectDialog } from "./NewProjectDialog";

type NewProjectButtonProps = {
  onProjectCreated: (createdProject: CreatedProject) => void;
};

function NewProjectButton({ onProjectCreated }: NewProjectButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarGroupAction
              type="button"
              aria-label="New Project"
              onClick={() => setDialogOpen(true)}
            >
              <Plus aria-hidden="true" />
            </SidebarGroupAction>
          }
        />
        <TooltipContent>New Project</TooltipContent>
      </Tooltip>
      <NewProjectDialog
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        onProjectCreated={onProjectCreated}
      />
    </>
  );
}

export { NewProjectButton };
