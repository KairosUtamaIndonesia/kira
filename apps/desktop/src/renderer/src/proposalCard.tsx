/**
 * One thing Kira proposed, and the person's gate on it.
 *
 * Every kind is drawn the same way — what it says, where it stands, and, while it
 * is waiting, Approve and Reject — because approving a card is the only way a
 * proposal reaches the tracker. What each kind says is `proposalMarkdown`'s.
 */
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import type { Proposal } from '../../preload/bridge';
import { proposalMarkdown } from './specPane';

/** What a person can say to a waiting proposal. Only an Outcome can be sent back. */
export type ProposalVerdict = 'approve' | 'reject' | 'send-back';

const TITLE: Record<Proposal['kind'], string> = {
  spec: 'Spec',
  map: 'Map',
  decision: 'Decision',
  outcome: 'Outcome',
  breakdown: 'Tickets',
};

const APPROVE: Record<Proposal['kind'], string> = {
  spec: 'Approve spec',
  map: 'Approve map',
  decision: 'Approve Decision',
  outcome: 'Approve Outcome',
  breakdown: 'Approve tickets',
};

function standing(proposal: Proposal): { label: string; variant: BadgeVariant } {
  if (proposal.kind === 'breakdown' && proposal.readyRefusal !== null) {
    return { label: 'Published as drafts', variant: 'warning' };
  }
  switch (proposal.status) {
    case 'proposed':
      return { label: 'Waiting for you', variant: 'info' };
    case 'approved':
      return { label: 'Approved', variant: 'success' };
    case 'rejected':
      return { label: 'Rejected', variant: 'neutral' };
    case 'replaced':
      return { label: 'Replaced', variant: 'neutral' };
  }
}

/**
 * Key it by the proposal's id: a newer proposal is a new card, so a refusal shown
 * for the last one does not carry over.
 */
export function ProposalCard({
  proposal,
  onDecide,
}: {
  proposal: Proposal;
  /** Ask for the verdict; answers the server's refusal, or null when it was taken. */
  onDecide: (proposalId: string, verdict: ProposalVerdict) => Promise<string | null>;
}) {
  // One request at a time per card: Approve and Reject racing would ask the
  // server to settle the same proposal twice.
  const [pending, setPending] = useState<ProposalVerdict | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const badge = standing(proposal);
  const title =
    proposal.kind === 'breakdown'
      ? `${TITLE.breakdown} · ${proposal.slices.length}`
      : TITLE[proposal.kind];

  async function decide(verdict: ProposalVerdict): Promise<void> {
    if (pending !== null) return;
    setPending(verdict);
    setRefusal(null);
    try {
      setRefusal(await onDecide(proposal.id, verdict));
    } finally {
      setPending(null);
    }
  }

  function action(verdict: ProposalVerdict, label: string, variant: 'primary' | 'secondary' | 'ghost') {
    return (
      <Button
        label={label}
        size="sm"
        variant={variant}
        isLoading={pending === verdict}
        isDisabled={pending !== null && pending !== verdict}
        onClick={() => void decide(verdict)}
      />
    );
  }

  return (
    <Card padding={3}>
      <VStack gap={2}>
        <HStack justify="between" align="center" gap={2}>
          <Text type="label" weight="medium">
            {title}
          </Text>
          <Badge label={badge.label} variant={badge.variant} />
        </HStack>
        <Markdown>{proposalMarkdown(proposal)}</Markdown>
        {proposal.kind === 'breakdown' && proposal.readyRefusal !== null && (
          <Banner
            status="warning"
            title="The tickets were published but not marked ready"
            description={`${proposal.readyRefusal} Kira can revise them and propose again.`}
          />
        )}
        {refusal !== null && (
          <Banner status="error" title="Kira would not take that" description={refusal} />
        )}
        {proposal.status === 'proposed' && (
          <HStack gap={2} wrap="wrap">
            {action('approve', APPROVE[proposal.kind], 'primary')}
            {proposal.kind === 'outcome' && action('send-back', 'Send back', 'secondary')}
            {action('reject', 'Reject', 'ghost')}
          </HStack>
        )}
      </VStack>
    </Card>
  );
}
