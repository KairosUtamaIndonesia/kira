import { useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyInvitedEmailAction } from "@/features/auth/actions/verifyInvitedEmail";
import { resolvePostAuthDestination } from "@/features/auth/data/postAuthDestination";
import { authClient } from "@/lib/auth/client";

const signInFailureMessage = "Sign-in failed. Check your email and password, then try again.";

type InvitationSignInContext = {
  invitedEmail: string;
  organizationName: string;
  organizationSlug: string;
  ssoRequired: boolean;
};

type SignInFormProperties = {
  invitationId: string | undefined;
  invitationContext: InvitationSignInContext | undefined;
  redirect: string | undefined;
};

function SignInForm({ invitationId, invitationContext, redirect }: SignInFormProperties) {
  const invitedEmail = invitationContext === undefined ? undefined : invitationContext.invitedEmail;
  const ssoOnlyInvite =
    invitationId !== undefined && invitationContext !== undefined && invitationContext.ssoRequired;
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">(
    invitationId === undefined ? "sign-in" : "sign-up",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSsoSubmitting, setIsSsoSubmitting] = useState(false);

  // Resolves the authenticated user's real destination (platform console, org
  // admin panel, org picker, or desktop-only terminal) and navigates there.
  // `invited` distinguishes a freshly-accepted invitation (friendly "you're
  // in" page) from an ordinary member sign-in (the desktop-only notice).
  const navigatePostAuth = useCallback(
    async (options: { invited: boolean }) => {
      const destination = await resolvePostAuthDestination();

      switch (destination.kind) {
        case "console":
          await router.navigate({ to: "/dashboard", replace: true });
          break;
        case "org":
          await router.navigate({
            to: "/org/$organizationId",
            params: { organizationId: destination.organizationId },
            replace: true,
          });
          break;
        case "org-picker":
          await router.navigate({ to: "/org", replace: true });
          break;
        case "member-only":
          if (options.invited) {
            await router.navigate({ to: "/invitation-accepted", replace: true });
          } else {
            await router.navigate({ to: "/access", replace: true });
          }
          break;
      }

      await router.invalidate();
    },
    [router],
  );

  useEffect(() => {
    if (!ssoOnlyInvite || invitationId === undefined) {
      return;
    }

    const pendingInvitationId = invitationId;
    let cancelled = false;

    async function acceptSsoInvitation() {
      const session = await authClient.getSession();

      if (cancelled || session.data === null) {
        return;
      }

      setIsSubmitting(true);
      const verificationResult = await verifyInvitedEmailAction({ data: pendingInvitationId });

      if (cancelled) {
        return;
      }

      if (verificationResult.status === "error") {
        setIsSubmitting(false);
        setErrorMessage(verificationResult.message);
        return;
      }

      const invitationResult = await authClient.organization.acceptInvitation({
        invitationId: pendingInvitationId,
      });

      if (cancelled) {
        return;
      }

      if (invitationResult.error) {
        setIsSubmitting(false);
        setErrorMessage(
          "Signed in, but invitation acceptance failed. Confirm you used the invited email address.",
        );
        return;
      }

      await navigatePostAuth({ invited: true });
    }

    void acceptSsoInvitation();

    return () => {
      cancelled = true;
    };
  }, [invitationId, navigatePostAuth, router, ssoOnlyInvite]);

  let submitLabel = "Sign in";

  if (isSubmitting && authMode === "sign-up") {
    submitLabel = "Creating account";
  } else if (isSubmitting) {
    submitLabel = "Signing in";
  } else if (authMode === "sign-up") {
    submitLabel = "Create account and accept invite";
  }

  async function handleSsoSignIn() {
    setErrorMessage(undefined);
    setIsSsoSubmitting(true);

    // Preserve the redirect param (desktop loopback URL + state) through the
    // SSO redirect chain. Without this the desktop sign-in flow collapses:
    // SSO redirects to /dashboard instead of back to /desktop-signin?…,
    // the user lands on a terminal page, and has to relaunch from the app.
    const callbackURL =
      redirect ??
      (invitationId === undefined ? "/dashboard" : `/sign-in?invitationId=${invitationId}`);

    const result = await authClient.signIn.sso({
      email,
      callbackURL,
      requestSignUp: invitationId !== undefined,
    });

    if (result.error) {
      setIsSsoSubmitting(false);
      setErrorMessage("Single sign-on is not available for this email. Use your password instead.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setIsSubmitting(true);

    const result =
      authMode === "sign-up"
        ? await authClient.signUp.email({
            email,
            password,
            name,
          })
        : await authClient.signIn.email({
            email,
            password,
          });

    if (result.error) {
      setIsSubmitting(false);
      if (result.error.message !== undefined && result.error.message.length > 0) {
        setErrorMessage(result.error.message);
      } else {
        setErrorMessage(
          authMode === "sign-up"
            ? "Account creation failed. Check your details, then try again."
            : signInFailureMessage,
        );
      }
      return;
    }

    if (invitationId !== undefined) {
      const verificationResult = await verifyInvitedEmailAction({ data: invitationId });

      if (verificationResult.status === "error") {
        setIsSubmitting(false);
        setErrorMessage(verificationResult.message);
        return;
      }

      const invitationResult = await authClient.organization.acceptInvitation({
        invitationId,
      });

      if (invitationResult.error) {
        setIsSubmitting(false);
        setErrorMessage(
          "Signed in, but invitation acceptance failed. Confirm you used the invited email address.",
        );
        return;
      }
    }

    // Only honor same-origin relative paths to avoid an open redirect; a
    // protocol-relative `//host` target is rejected. A captured destination
    // (e.g. desktop sign-in) takes precedence over the role-based default.
    const safeRedirect =
      redirect !== undefined && redirect.startsWith("/") && !redirect.startsWith("//")
        ? redirect
        : undefined;

    if (safeRedirect !== undefined) {
      await router.navigate({ to: safeRedirect, replace: true });
      await router.invalidate();
      return;
    }

    await navigatePostAuth({ invited: invitationId !== undefined });
  }

  if (ssoOnlyInvite && invitationContext !== undefined) {
    return (
      <div className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" value={email} disabled />
          <p className="text-xs text-muted-foreground">
            Invitations for {invitationContext.organizationName} must be accepted with Single
            Sign-On.
          </p>
        </div>
        {errorMessage !== undefined ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : undefined}
        <Button
          type="button"
          className="w-full"
          disabled={isSsoSubmitting || email.length === 0}
          onClick={handleSsoSignIn}
        >
          {isSsoSubmitting ? <Loader2 aria-hidden="true" className="animate-spin" /> : undefined}
          Continue with Single Sign-On
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      {authMode === "sign-up" ? (
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            aria-invalid={errorMessage !== undefined}
          />
        </div>
      ) : undefined}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          disabled={authMode === "sign-up" && invitedEmail !== undefined}
          required
          aria-invalid={errorMessage !== undefined}
        />
        {authMode === "sign-up" && invitedEmail !== undefined ? (
          <p className="text-xs text-muted-foreground">
            Invitations must be accepted with the invited email address.
          </p>
        ) : undefined}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={isSubmitting || isSsoSubmitting || email.length === 0}
        onClick={handleSsoSignIn}
      >
        {isSsoSubmitting ? <Loader2 aria-hidden="true" className="animate-spin" /> : undefined}
        Continue with Single Sign-On
      </Button>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          minLength={8}
          required
          aria-invalid={errorMessage !== undefined}
        />
        {authMode === "sign-up" ? (
          <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
        ) : undefined}
      </div>
      {errorMessage !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : undefined}
      <Button type="submit" className="w-full" disabled={isSubmitting || isSsoSubmitting}>
        {isSubmitting ? <Loader2 aria-hidden="true" className="animate-spin" /> : undefined}
        {submitLabel}
      </Button>
      {invitationId === undefined ? undefined : (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={isSubmitting}
          onClick={() => {
            setErrorMessage(undefined);
            setAuthMode(authMode === "sign-up" ? "sign-in" : "sign-up");
          }}
        >
          {authMode === "sign-up" ? "I already have an account" : "I need to create an account"}
        </Button>
      )}
    </form>
  );
}

export { SignInForm };
