import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { createHandoff } from "@/features/desktop-signin/data/desktopSignin";
import { organizationDesktopAccessConfigId } from "@/features/organizations/data/organizationApiKeys";
import {
  type MembershipOrganization,
  listOrganizationsForMember,
} from "@/features/organizations/data/organizations";
import { auth } from "@/lib/auth/auth";
import { getSessionFn } from "@/lib/auth/session";

const desktopSigninSearchSchema = z.object({
  redirect_uri: z.string().optional(),
  state: z.string().optional(),
});

const completeSigninInputSchema = z.object({
  redirectUri: z.string().min(1),
  state: z.string().min(1),
  organizationId: z.string().min(1),
});

type DesktopSigninContext =
  | { state: "no-organization" }
  | { state: "ready"; email: string; organizations: MembershipOrganization[] };

type CompleteResult = { status: "ok"; callbackUrl: string } | { status: "error"; message: string };

// The desktop hands back a loopback callback it is listening on; only plain
// http on 127.0.0.1/localhost is accepted so the credential can never be
// redirected to a remote origin.
function isLoopbackUri(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function buildCallbackUrl(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return url.toString();
}

function firstOrganizationId(organizations: MembershipOrganization[]): string {
  const [first] = organizations;
  return first === undefined ? "" : first.id;
}

function firstOrganizationName(organizations: MembershipOrganization[]): string {
  const [first] = organizations;
  return first === undefined ? "" : first.name;
}

const getDesktopSigninContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<DesktopSigninContext> => {
    const session = await auth.api.getSession({ headers: getRequest().headers });

    if (session === null) {
      throw notFound();
    }

    const organizations = await listOrganizationsForMember(session.user.id);

    if (organizations.length === 0) {
      return { state: "no-organization" };
    }

    return { state: "ready", email: session.user.email, organizations };
  },
);

const completeDesktopSignin = createServerFn({ method: "POST" })
  .validator((input: { redirectUri: string; state: string; organizationId: string }) =>
    completeSigninInputSchema.parse(input),
  )
  .handler(async ({ data: input }): Promise<CompleteResult> => {
    if (!isLoopbackUri(input.redirectUri)) {
      return { status: "error", message: "Invalid desktop callback target." };
    }

    const requestHeaders = getRequest().headers;
    const session = await auth.api.getSession({ headers: requestHeaders });

    if (session === null) {
      return { status: "error", message: "Sign in before continuing." };
    }

    const organizations = await listOrganizationsForMember(session.user.id);
    const organization = organizations.find((entry) => entry.id === input.organizationId);

    if (organization === undefined) {
      return { status: "error", message: "Select an organization you belong to." };
    }

    const created = await auth.api.createApiKey({
      headers: requestHeaders,
      body: {
        configId: organizationDesktopAccessConfigId,
        name: "Kira Desktop",
        metadata: { organizationId: organization.id },
      },
    });

    const code = await createHandoff({
      userId: session.user.id,
      organizationId: organization.id,
      organizationName: organization.name,
      apiKey: created.key,
    });

    return { status: "ok", callbackUrl: buildCallbackUrl(input.redirectUri, code, input.state) };
  });

export const Route = createFileRoute("/desktop-signin")({
  validateSearch: desktopSigninSearchSchema,
  beforeLoad: async ({ location }) => {
    const session = await getSessionFn();

    if (session === null) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
  },
  loaderDeps: ({ search }) => ({ redirectUri: search.redirect_uri, state: search.state }),
  loader: async ({ deps }) => {
    if (
      deps.redirectUri === undefined ||
      deps.state === undefined ||
      !isLoopbackUri(deps.redirectUri)
    ) {
      throw notFound();
    }

    return getDesktopSigninContext();
  },
  component: DesktopSigninPage,
});

function DesktopSigninPage() {
  const context = Route.useLoaderData();
  const { redirect_uri: redirectUri, state } = Route.useSearch();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    context.state === "ready" ? firstOrganizationId(context.organizations) : "",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleContinue() {
    if (redirectUri === undefined || state === undefined) {
      return;
    }

    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const result = await completeDesktopSignin({
        data: { redirectUri, state, organizationId: selectedOrganizationId },
      });

      if (result.status === "ok") {
        window.location.assign(result.callbackUrl);
        return;
      }

      setErrorMessage(result.message);
      setIsSubmitting(false);
    } catch {
      setErrorMessage("Could not complete sign-in. Try again.");
      setIsSubmitting(false);
    }
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Kira Desktop
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to the desktop app</h1>
        </div>

        {context.state === "no-organization" ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Your account is not a member of any organization yet. Ask an administrator to add you to
            an organization, then try signing in again.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              Continue as <span className="font-medium text-foreground">{context.email}</span>. The
              desktop app will open automatically once you continue.
            </p>

            {context.organizations.length > 1 ? (
              <div>
                <label
                  htmlFor="desktop-signin-org"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Organization
                </label>
                <select
                  id="desktop-signin-org"
                  value={selectedOrganizationId}
                  onChange={(event) => setSelectedOrganizationId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {context.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Organization:{" "}
                <span className="font-medium text-foreground">
                  {firstOrganizationName(context.organizations)}
                </span>
              </p>
            )}

            <Button
              disabled={isSubmitting || redirectUri === undefined || state === undefined}
              onClick={() => {
                void handleContinue();
              }}
            >
              Continue to desktop
            </Button>

            {errorMessage === undefined ? undefined : (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
