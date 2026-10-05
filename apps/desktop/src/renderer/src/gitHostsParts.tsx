/** PROTOTYPE — the one piece the Git hosts variants share: a copy control. Wipe me with them. */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useClipboard } from '@astryxdesign/core/hooks';
import { Check, Copy } from 'lucide-react';

export function CopyButton({
  value,
  label,
  onCopied,
}: {
  value: string;
  label: string;
  onCopied?: () => void;
}) {
  const { copy, isCopied } = useClipboard({ announce: `${label} copied` });

  return (
    <IconButton
      label={isCopied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      icon={<Icon icon={isCopied ? Check : Copy} size="sm" />}
      size="sm"
      variant="ghost"
      onClick={() => {
        void copy(value).then((ok) => {
          if (ok) onCopied?.();
        });
      }}
    />
  );
}
