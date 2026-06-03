import { SignInForm } from "@/features/auth/components/SignInForm";
import { getInvitationSignInContext } from "@/features/organizations/data/organizations";

type SignInPageProperties = {
  searchParams: Promise<{ invitationId?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProperties) {
  const { invitationId } = await searchParams;
  let invitationContext;

  if (invitationId !== undefined) {
    invitationContext = await getInvitationSignInContext(invitationId);
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
        {invitationId === undefined || invitationContext === undefined ? undefined : (
          <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
            {invitationContext.ssoRequired
              ? `${invitationContext.organizationName} requires Single Sign-On. Continue with your organization identity provider to accept this invitation.`
              : "If you do not have a password yet, create an account with the invited email address."}
          </div>
        )}
        <SignInForm invitationId={invitationId} invitationContext={invitationContext} />
      </section>
    </main>
  );
}
