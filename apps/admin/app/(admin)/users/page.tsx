import { Suspense } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listPlatformUsersForAdmin } from "@/features/users/data/users";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Platform administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        </div>
      </div>
      <Suspense fallback={<UsersTableLoading />}>
        <UsersTable />
      </Suspense>
    </div>
  );
}

async function UsersTable() {
  const users = await listPlatformUsersForAdmin();

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-4">
        <h2 className="font-medium">Platform users</h2>
        <p className="text-sm text-muted-foreground">
          Real users from Better Auth platform administration data.
        </p>
      </div>
      {users.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No users found</EmptyTitle>
            <EmptyDescription>
              Seed or create an admin user to populate this table.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Platform role</th>
                <th className="py-2 pr-4 font-medium">Organizations</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 font-medium">{user.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{user.email}</td>
                  <td className="py-3 pr-4 capitalize">{user.platformRole}</td>
                  <td className="py-3 pr-4">{user.organizationCount}</td>
                  <td className="py-3 pr-4 capitalize">{user.status}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{user.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UsersTableLoading() {
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm text-muted-foreground">Loading platform users…</p>
    </section>
  );
}
