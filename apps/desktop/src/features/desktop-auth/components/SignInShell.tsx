import type { ReactNode } from "react";

import { AppWindowControls } from "@/features/app-shell/components/AppWindowControls";
import { useTitleBarDrag } from "@/features/app-shell/components/useTitleBarDrag";

type SignInShellProps = {
  children: ReactNode;
};

function SignInShell({ children }: SignInShellProps) {
  const { handleTitleBarDoubleClick, handleTitleBarMouseDown, titleBarError } = useTitleBarDrag();

  return (
    <div className="fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-background text-foreground">
      <div
        role="toolbar"
        aria-label="Sign-in window controls"
        tabIndex={-1}
        className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-sidebar pl-6 text-sidebar-foreground select-none"
        onDoubleClick={(event) => {
          void handleTitleBarDoubleClick(event);
        }}
        onMouseDown={(event) => {
          void handleTitleBarMouseDown(event);
        }}
      >
        <div className="text-sm font-medium">Kira</div>
        <AppWindowControls />
      </div>
      <div className="min-h-0 flex-1 scrollbar-sleek overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 p-8">
          {children}
        </div>
      </div>
      {titleBarError === undefined ? undefined : (
        <output className="sr-only">{titleBarError}</output>
      )}
    </div>
  );
}

export { SignInShell };
