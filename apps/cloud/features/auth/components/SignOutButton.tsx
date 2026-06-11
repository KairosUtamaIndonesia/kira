import { useRouter } from "@tanstack/react-router";
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
        await router.invalidate();
        await router.navigate({ to: "/sign-in", replace: true });
      }}
    >
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}

export { SignOutButton };
