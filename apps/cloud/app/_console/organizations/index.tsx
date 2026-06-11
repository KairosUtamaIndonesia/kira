import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Building2, MoreHorizontal, Settings, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { Organization } from "@/features/organizations/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { CreateOrganizationForm } from "@/features/organizations/components/CreateOrganizationForm";
import { listOrganizationsForPlatform } from "@/features/platform/organizations/data/organizations";
import { requirePlatformAdmin } from "@/lib/auth/guards";

const loadOrganizations = createServerFn().handler(async () => {
  await requirePlatformAdmin();
  return listOrganizationsForPlatform();
});

export const Route = createFileRoute("/_console/organizations/")({
  loader: () => loadOrganizations(),
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const organizations = Route.useLoaderData();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">SaaS administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create organization</Button>
      </div>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => setCreateOpen(false)}
      />

      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="mb-4">
          <h2 className="font-medium">Managed organizations</h2>
          <p className="text-sm text-muted-foreground">
            All Kira organizations managed from this console.
          </p>
        </div>
        {organizations.length === 0 ? (
          <OrganizationsEmptyState onCreateClick={() => setCreateOpen(true)} />
        ) : (
          <OrganizationsTable organizations={organizations} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

type CreateOrganizationDialogProperties = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

function CreateOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateOrganizationDialogProperties) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Add a new organization for Kira SaaS administration.
          </DialogDescription>
        </DialogHeader>
        <CreateOrganizationForm onSuccess={onSuccess} />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function OrganizationsEmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <Empty>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <Building2 aria-hidden className="size-6 text-muted-foreground" />
      </div>
      <EmptyHeader>
        <EmptyTitle>No organizations yet</EmptyTitle>
        <EmptyDescription>Create your first organization to get started.</EmptyDescription>
      </EmptyHeader>
      <Button className="mt-4" variant="outline" onClick={onCreateClick}>
        Create organization
      </Button>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function OrgStatusBadge({ status }: { status: Organization["status"] }) {
  if (status === "active") {
    return (
      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Active
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

type OrganizationsTableProperties = {
  organizations: Organization[];
};

function OrganizationsTable({ organizations }: OrganizationsTableProperties) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground uppercase">
          <tr>
            <th className="py-2 pr-4 font-medium">Organization</th>
            <th className="py-2 pr-4 font-medium">Slug</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Members</th>
            <th className="py-2 pr-4 font-medium">API Keys</th>
            <th className="py-2 pr-4 font-medium">Created</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((organization) => (
            <tr
              key={organization.id}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
            >
              <td className="py-3 pr-4 font-medium">
                <Link
                  to="/org/$organizationId"
                  params={{ organizationId: organization.id }}
                  className="hover:underline"
                >
                  {organization.name}
                </Link>
              </td>
              <td className="py-3 pr-4 text-muted-foreground">{organization.slug}</td>
              <td className="py-3 pr-4">
                <OrgStatusBadge status={organization.status} />
              </td>
              <td className="py-3 pr-4">{organization.memberCount}</td>
              <td className="py-3 pr-4">{organization.apiKeyCount}</td>
              <td className="py-3 pr-4 text-muted-foreground">{organization.createdAt}</td>
              <td className="py-3 text-right">
                <OrgRowActions organization={organization} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function OrgRowActions({ organization }: { organization: Organization }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${organization.name}`} />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<Link to="/org/$organizationId" params={{ organizationId: organization.id }} />}
        >
          <Building2 className="size-4" />
          View
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link to="/org/$organizationId/settings" params={{ organizationId: organization.id }} />
          }
        >
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <Link to="/org/$organizationId/settings" params={{ organizationId: organization.id }} />
          }
        >
          <ShieldCheck className="size-4" />
          Manage SSO
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
