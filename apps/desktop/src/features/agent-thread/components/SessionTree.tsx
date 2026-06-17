import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Info,
  Tag,
  Terminal,
  User,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { SessionTreeNodeJson } from "../types";

type SessionTreeProps = {
  nodes: SessionTreeNodeJson[];
  activePath: string[];
  activeLeafId: string | undefined;
  onSelectNode: (nodeId: string) => void;
};

function SessionTree({ nodes, activePath, activeLeafId, onSelectNode }: SessionTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Auto-expand every node that has children (matching TUI behavior).
    const all: string[] = [];
    const collect = (list: SessionTreeNodeJson[]) => {
      for (const node of list) {
        if (node.children.length > 0) {
          all.push(node.id);
          collect(node.children);
        }
      }
    };
    collect(nodes);
    return new Set(all);
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Compute flat list of visible nodes for keyboard navigation.
  const visibleNodes = useMemo(() => {
    const result: { id: string; depth: number }[] = [];
    const walk = (list: SessionTreeNodeJson[], depth: number) => {
      for (const node of list) {
        result.push({ id: node.id, depth });
        if (node.children.length > 0 && expandedIds.has(node.id)) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(nodes, 0);
    return result;
  }, [nodes, expandedIds]);

  const [focusedIndex, setFocusedIndex] = useState(0);

  // Ensure focusedIndex stays within bounds when tree changes.
  useEffect(() => {
    if (visibleNodes.length === 0) {
      return;
    }
    setFocusedIndex((prev) => Math.min(prev, visibleNodes.length - 1));
  }, [visibleNodes.length]);

  // Scroll the focused tree item into view when keyboard navigation moves focus.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const el = container.querySelector("[data-tree-focused=true]");
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);
  const focusedNode =
    focusedIndex >= 0 && focusedIndex < visibleNodes.length
      ? visibleNodes[focusedIndex]
      : undefined;
  const focusedId = focusedNode !== undefined ? focusedNode.id : undefined;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (visibleNodes.length === 0) {
        return;
      }

      const currentIndex = focusedIndex;
      const currentNode =
        currentIndex >= 0 && currentIndex < visibleNodes.length
          ? visibleNodes[currentIndex]
          : undefined;
      const currentId = currentNode !== undefined ? currentNode.id : undefined;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex(Math.min(currentIndex + 1, visibleNodes.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex(Math.max(currentIndex - 1, 0));
          break;
        case "ArrowRight":
          event.preventDefault();
          if (currentId !== undefined) {
            // If collapsed and has children → expand.
            if (!expandedIds.has(currentId)) {
              toggleExpand(currentId);
            }
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (currentId !== undefined) {
            // If expanded → collapse.
            if (expandedIds.has(currentId)) {
              toggleExpand(currentId);
            } else {
              // Move focus to parent (walk up from depth 0).
              const node = visibleNodes[currentIndex];
              const currentDepth = node !== undefined ? node.depth : 0;
              if (currentDepth > 0) {
                for (let i = currentIndex - 1; i >= 0; i--) {
                  const n = visibleNodes[i];
                  if (n !== undefined && n.depth < currentDepth) {
                    setFocusedIndex(i);
                    break;
                  }
                }
              }
            }
          }
          break;
        case "Enter":
          event.preventDefault();
          if (currentId !== undefined) {
            onSelectNode(currentId);
          }
          break;
      }
    },
    [visibleNodes, focusedIndex, expandedIds, toggleExpand, onSelectNode],
  );

  return (
    <div role="tree" aria-label="Session tree" tabIndex={0} onKeyDown={handleKeyDown}>
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          focusedId={focusedId}
          activePath={activePath}
          activeLeafId={activeLeafId}
          onSelectNode={onSelectNode}
          onToggle={toggleExpand}
        />
      ))}
    </div>
  );
}

type TreeNodeProps = {
  node: SessionTreeNodeJson;
  depth: number;
  expandedIds: Set<string>;
  focusedId: string | undefined;
  activePath: string[];
  activeLeafId: string | undefined;
  onSelectNode: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
};
function TreeNode({
  node,
  depth,
  expandedIds,
  focusedId,
  activeLeafId,
  activePath,
  onSelectNode,
  onToggle,
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isLeaf = activeLeafId === node.id;
  const isOnActivePath = activePath.includes(node.id);
  const isFocused = focusedId === node.id;
  let itemVariant = "text-muted-foreground";
  if (isLeaf) {
    itemVariant = "bg-primary/10 text-primary";
  } else if (isOnActivePath) {
    itemVariant = "text-foreground";
  }
  const itemClassName = `flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:bg-accent/50 ${itemVariant} ${isFocused ? "ring-1 ring-ring ring-inset" : ""}`;
  return (
    <div role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <button
        type="button"
        className={itemClassName}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => {
          onSelectNode(node.id);
        }}
        data-tree-focused={isFocused || undefined}
      >
        {/* Expand/collapse chevron */}
        <button
          type="button"
          className={`flex size-4 shrink-0 items-center justify-center ${
            hasChildren ? "cursor-pointer opacity-60 hover:opacity-100" : "opacity-0"
          }`}
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              onToggle(node.id);
            }
          }}
          onKeyDown={(e) => {
            if (hasChildren && (e.key === "Enter" || e.key === " ")) {
              e.stopPropagation();
              onToggle(node.id);
            }
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Entry type icon */}
        <span className="flex size-4 shrink-0 items-center justify-center">
          <EntryIcon entry={node.entry} />
        </span>

        {/* Text preview */}
        <span className="min-w-0 truncate leading-5">
          {node.entry.text ?? <span className="italic opacity-50">empty</span>}
        </span>

        {/* Label badge */}
        {node.entry.label !== undefined ? (
          <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-blue-500/10 px-1 text-[10px] text-blue-500">
            <Tag size={10} />
            <span className="max-w-20 truncate">{node.entry.label}</span>
          </span>
        ) : undefined}
      </button>

      {/* Children */}
      {hasChildren && isExpanded ? (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              focusedId={focusedId}
              activePath={activePath}
              activeLeafId={activeLeafId}
              onSelectNode={onSelectNode}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : undefined}
    </div>
  );
}

function EntryIcon({ entry }: { entry: SessionTreeNodeJson["entry"] }): ReactNode {
  switch (entry.type) {
    case "message":
      if (entry.role === "user") {
        return <User size={14} className="text-blue-400" />;
      }
      return <Brain size={14} className="text-emerald-400" />;
    case "tool_call":
      return <Terminal size={14} className="text-amber-400" />;
    case "thinking":
      return <EyeIcon size={14} className="text-purple-400" />;
    case "compaction":
      return <FileText size={14} className="text-orange-400" />;
    case "branch_summary":
      return <GitBranchIcon size={14} className="text-cyan-400" />;
    case "label":
      return <Tag size={14} className="text-blue-400" />;
    case "custom":
    case "custom_message":
      return <FileText size={14} className="text-gray-400" />;
    case "session_info":
    case "session":
      return <Info size={14} className="text-gray-400" />;
    default:
      return <Info size={14} className="text-muted-foreground" />;
  }
}

function EyeIcon(props: { size: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GitBranchIcon(props: { size: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export { SessionTree };
export type { SessionTreeProps };
