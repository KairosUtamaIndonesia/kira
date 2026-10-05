/** The menu that says how a diff is drawn: inline or side by side, and whether long lines wrap. */
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { Check, Settings2 } from 'lucide-react';
import type { DiffStyle } from './diffView';

export function DiffOptionsMenu({
  diffStyle,
  wrap,
  onDiffStyle,
  onWrap,
}: {
  diffStyle: DiffStyle;
  wrap: boolean;
  onDiffStyle: (style: DiffStyle) => void;
  onWrap: (wrap: boolean) => void;
}) {
  const checked = <Icon icon={Check} size="sm" />;

  return (
    <DropdownMenu
      button={{
        label: 'Diff options',
        size: 'sm',
        variant: 'ghost',
        isIconOnly: true,
        icon: <Icon icon={Settings2} size="sm" />,
      }}
      items={[
        {
          label: 'Inline',
          endContent: diffStyle === 'unified' ? checked : undefined,
          onClick: () => onDiffStyle('unified'),
        },
        {
          label: 'Side by side',
          endContent: diffStyle === 'split' ? checked : undefined,
          onClick: () => onDiffStyle('split'),
        },
        { type: 'divider' },
        {
          label: 'Wrap lines',
          endContent: wrap ? checked : undefined,
          onClick: () => onWrap(!wrap),
        },
      ]}
    />
  );
}
