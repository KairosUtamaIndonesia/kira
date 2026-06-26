import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

type AgentThreadMarkdownProps = {
  markdown: string;
  isStreaming: boolean;
  className?: string;
};

function AgentThreadMarkdown({ isStreaming, markdown, className }: AgentThreadMarkdownProps) {
  return (
    <Streamdown
      caret="block"
      className={cn(
        "max-w-none space-y-3 text-sm leading-6 text-foreground",
        "**:data-[streamdown='code-block']:border-0 **:data-[streamdown='code-block']:bg-transparent **:data-[streamdown='code-block']:p-0 **:data-[streamdown='code-block']:shadow-none",
        "[&_[data-streamdown='code-block']_pre]:overflow-x-auto [&_[data-streamdown='code-block']_pre]:rounded-none [&_[data-streamdown='code-block']_pre]:border-0 [&_[data-streamdown='code-block']_pre]:border-l [&_[data-streamdown='code-block']_pre]:border-border/30 [&_[data-streamdown='code-block']_pre]:bg-transparent [&_[data-streamdown='code-block']_pre]:p-0 [&_[data-streamdown='code-block']_pre]:pl-2.5 [&_[data-streamdown='code-block']_pre]:shadow-none",
        "[&_[data-streamdown='code-block']>*:first-child]:border-0 [&_[data-streamdown='code-block']>*:first-child]:bg-transparent [&_[data-streamdown='code-block']>*:first-child]:p-0 [&_[data-streamdown='code-block']>*:first-child]:pb-1.5",
        "[&_a]:underline [&_code]:font-mono [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      controls={{
        code: { copy: true, download: false },
        table: { copy: true, download: false, fullscreen: false },
        mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
      }}
      mode={isStreaming ? "streaming" : "static"}
      isAnimating={isStreaming}
    >
      {markdown}
    </Streamdown>
  );
}

export { AgentThreadMarkdown };
