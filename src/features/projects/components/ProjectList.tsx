import { Folder } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

import type { Project } from "../types";

type ProjectListProps = {
  projects: Project[];
};

function ProjectList({ projects }: ProjectListProps) {
  if (projects.length === 0) {
    return <p className="px-2 text-sm text-sidebar-foreground/60">No projects yet</p>;
  }

  return (
    <SidebarMenu aria-label="Projects">
      {projects.map((project) => (
        <SidebarMenuItem key={project.id}>
          <SidebarMenuButton
            className="font-bold"
            render={<button type="button" aria-label={project.name} />}
          >
            <Folder aria-hidden="true" />
            <span>{project.name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export { ProjectList };
