"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isSigningOut}
      onClick={async () => {
        setIsSigningOut(true);
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}

export { SignOutButton };
