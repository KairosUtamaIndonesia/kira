import { useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { OrganizationProvider } from "@/features/organizations/types";

import { Button } from "@/components/ui/button";
import {
  deleteOrgProviderAction,
  getOrgProviderAction,
} from "@/features/org-admin/providers/actions/manageProviders";

import { ProviderForm } from "./ProviderForm";

type ProviderListProperties = {
  organizationId: string;
  providers: Array<Omit<OrganizationProvider, "apiKey">>;
};

function ProviderList({ organizationId, providers }: ProviderListProperties) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<OrganizationProvider>();
  const [loadingProvider, setLoadingProvider] = useState(false);

  const handleAdd = () => {
    setEditingProvider(undefined);
    setShowForm(true);
  };

  const handleEdit = async (provider: Omit<OrganizationProvider, "apiKey">) => {
    setLoadingProvider(true);
    setShowForm(true);

    const result = await getOrgProviderAction({
      data: { organizationId, id: provider.id },
    });

    if (result.status === "success") {
      setEditingProvider(result.provider);
    } else {
      setEditingProvider({
        ...provider,
        apiKey: undefined,
      });
    }

    setLoadingProvider(false);
  };

  const handleDelete = async (provider: Omit<OrganizationProvider, "apiKey">) => {
    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      `Delete provider "${provider.label}"? This will affect all models using this provider.`,
    );
    if (!confirmed) {
      return;
    }

    await deleteOrgProviderAction({
      data: { organizationId, id: provider.id },
    });
    await router.invalidate();
  };

  const handleDone = () => {
    setShowForm(false);
    setEditingProvider(undefined);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingProvider(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Providers</h3>
        {!showForm ? (
          <Button type="button" size="sm" onClick={handleAdd}>
            <Plus className="size-4" />
            Add Provider
          </Button>
        ) : undefined}
      </div>

      {showForm ? (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {editingProvider === undefined ? "New Provider" : "Edit Provider"}
            </h4>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
          {loadingProvider ? (
            <p className="text-sm text-muted-foreground">Loading provider details...</p>
          ) : (
            <ProviderForm
              organizationId={organizationId}
              {...(editingProvider !== undefined ? { provider: editingProvider } : {})}
              onDone={handleDone}
            />
          )}
        </div>
      ) : undefined}

      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No providers configured yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Label</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Provider ID
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Base URL</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{provider.label}</td>
                  <td className="px-3 py-2 font-mono text-xs">{provider.providerId}</td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs">
                    {provider.providerBaseUrl}
                  </td>
                  <td className="px-3 py-2 text-right" aria-label="Actions">
                    <div className="inline-flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => handleEdit(provider)}
                      >
                        <Pencil className="size-3" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        onClick={() => handleDelete(provider)}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { ProviderList };
