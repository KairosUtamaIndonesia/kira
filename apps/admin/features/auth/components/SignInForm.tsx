"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyInvitedEmailAction } from "@/features/auth/actions/verifyInvitedEmail";
import { authClient } from "@/lib/auth/client";

const signInFailureMessage = "Sign-in failed. Check your email and password, then try again.";

type SignInFormProperties = {
  invitationId: string | undefined;
  invitedEmail: string | undefined;
};

function SignInForm({ invitationId, invitedEmail }: SignInFormProperties) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">(
    invitationId === undefined ? "sign-in" : "sign-up",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  let submitLabel = "Sign in";

  if (isSubmitting && authMode === "sign-up") {
    submitLabel = "Creating account";
  } else if (isSubmitting) {
    submitLabel = "Signing in";
  } else if (authMode === "sign-up") {
    submitLabel = "Create account and accept invite";
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
      const verificationResult = await verifyInvitedEmailAction(invitationId);

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

    if (result.data.user.role === "admin") {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    router.replace("/invitation-accepted");
    router.refresh();
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
      <Button type="submit" className="w-full" disabled={isSubmitting}>
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
