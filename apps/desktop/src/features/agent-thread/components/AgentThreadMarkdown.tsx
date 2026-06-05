import { Streamdown } from "streamdown";

type AgentThreadMarkdownProps = {
  markdown: string;
  isStreaming: boolean;
};

function AgentThreadMarkdown({ isStreaming, markdown }: AgentThreadMarkdownProps) {
  return (
    <Streamdown
      animated
      caret="block"
      className="max-w-none space-y-3 text-sm leading-6 text-foreground [&_a]:underline [&_code]:font-mono [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5"
      controls={{
        code: { copy: true, download: false },
        table: { copy: true, download: false, fullscreen: false },
        mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
      }}
      isAnimating={isStreaming}
      mode={isStreaming ? "streaming" : "static"}
    >
      {markdown}
    </Streamdown>
  );
}

export { AgentThreadMarkdown };
