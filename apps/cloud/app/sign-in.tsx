import type { ReactNode } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SignInForm } from "@/features/auth/components/SignInForm";
import { getInvitationSignInContext } from "@/features/auth/data/membership";

const signInSearchSchema = z.object({
  invitationId: z.string().optional(),
  redirect: z.string().optional(),
});

const loadInvitationContext = createServerFn()
  .validator((invitationId: string) => invitationId)
  .handler(({ data: invitationId }) => getInvitationSignInContext(invitationId));

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearchSchema,
  loaderDeps: ({ search }) => ({ invitationId: search.invitationId }),
  loader: async ({ deps }) => {
    if (deps.invitationId === undefined) {
      return { invitationContext: undefined };
    }

    return { invitationContext: await loadInvitationContext({ data: deps.invitationId }) };
  },
  component: SignInPage,
});

function SignInPage() {
  const { invitationId, redirect } = Route.useSearch();
  const { invitationContext } = Route.useLoaderData();

  const isExpiredInvitation =
    invitationId !== undefined && invitationContext !== undefined && invitationContext.isExpired;

  let invitationMessage: ReactNode;
  if (isExpiredInvitation) {
    invitationMessage = (
      <div className="mt-4 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">Invitation expired</p>
        <p className="text-muted-foreground">
          This invitation to{" "}
          <span className="font-medium">{invitationContext.organizationName}</span> has expired. Ask
          an organization administrator to send a new invitation.
        </p>
      </div>
    );
  } else if (invitationContext !== undefined) {
    invitationMessage = (
      <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
        {invitationContext.ssoRequired
          ? `${invitationContext.organizationName} requires Single Sign-On. Continue with your organization identity provider to accept this invitation.`
          : "If you do not have a password yet, create an account with the invited email address."}
      </div>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira Admin
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invitationId === undefined ? "Sign in" : "Accept invitation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invitationId === undefined
              ? "Use your admin credentials to manage Kira organizations, users, and access."
              : "Create an account or sign in with the invited email address."}
          </p>
        </div>
        {invitationMessage}
        {isExpiredInvitation ? undefined : (
          <SignInForm
            invitationId={invitationId}
            invitationContext={invitationContext}
            redirect={redirect}
          />
        )}
      </section>
    </main>
  );
}
