/**
 * A subagent run's state as one small mark. Only a run that needs attention is
 * coloured — working pulses in the accent, a failure is red — while a finished
 * run is a quiet grey check, so a panel of completed work reads as settled
 * rather than as a row of green lights.
 */
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Check, Square, X } from 'lucide-react';
import type { SubagentSummary } from '../../preload/bridge';

export const AGENT_STATE_WORD = {
  running: 'Working',
  complete: 'Done',
  error: 'Failed',
  stopped: 'Stopped',
} as const;

export function AgentStateMark({ state }: { state: SubagentSummary['state'] }) {
  const label = AGENT_STATE_WORD[state];
  switch (state) {
    case 'running':
      return <StatusDot variant="accent" label={label} isPulsing />;
    case 'complete':
      return <Icon icon={Check} size="sm" color="secondary" label={label} />;
    case 'error':
      return <Icon icon={X} size="sm" color="error" label={label} />;
    case 'stopped':
      return <Icon icon={Square} size="sm" color="tertiary" label={label} />;
  }
}
