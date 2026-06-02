type Project = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
};

type Session = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

type CreateProjectInput = {
  name: string;
  folderPath: string;
};

type CreatedProject = {
  project: Project;
  defaultSession: Session;
};

export type { CreatedProject, CreateProjectInput, Project, Session };
