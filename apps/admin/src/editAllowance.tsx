import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { useState } from 'react';
import { type Reading, setAllowance } from './api/allowances';
import type { ListedUser } from './api/users';
import { formatTokens, formatWhen } from './allowanceText';

/**
 * One person's month, and the way to change what they are allowed.
 *
 * A dialog rather than a field in the row: this is a decision about somebody else's
 * access, and a table of live number inputs is a table where a scroll can edit a
 * person by accident. What the server answers with is what the row then shows, so
 * the screen never claims a number the server did not accept.
 *
 * What they were turned away for belongs here too, because the answer to "why is
 * this person blocked?" is a reason and a time, which is more than a row can hold.
 */
export default function EditAllowance({
  person,
  reading,
  onChanged,
  onClose,
}: {
  person: Pick<ListedUser, 'id' | 'name'>;
  reading: Reading;
  onChanged: (reading: Reading) => void;
  onClose: () => void;
}) {
  const [tokens, setTokens] = useState<number | null>(reading.override ?? reading.allowance);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(wanted: number | null) {
    setBusy(true);
    const saved = await setAllowance(person.id, wanted);
    setBusy(false);

    if (!saved.ok) {
      setProblem(saved.message);
      return;
    }

    onChanged(saved.value);
    onClose();
  }

  return (
    <Dialog isOpen purpose="form" onOpenChange={() => onClose()}>
      <DialogHeader title={`${person.name}'s allowance`} onOpenChange={() => onClose()} />
      <div className="allowanceForm">
        <Text color="secondary">
          Tokens per WIB calendar month, counted as input plus output.{' '}
          {reading.override === null
            ? `Nobody has given them a number of their own, so this is the one everybody gets: ${formatTokens(reading.allowance)}.`
            : 'Their own number, replacing the one everybody else gets.'}
        </Text>
        <NumberInput
          label="Tokens per month"
          value={tokens}
          onChange={setTokens}
          isDisabled={busy}
          status={problem === null ? undefined : { type: 'error', message: problem }}
        />
        {reading.refusals.length === 0 ? null : (
          <div className="allowanceRefusals">
            <Text weight="semibold">Turned away this month</Text>
            {reading.refusals.map((refusal, index) => (
              <Text
                key={`${refusal.at}-${String(index)}`}
                color="secondary"
                size="sm"
              >{`${formatWhen(refusal.at)} — ${refusal.model} — ${refusal.reason}`}</Text>
            ))}
          </div>
        )}
        <div className="allowanceActions">
          <Button
            label="Save"
            variant="primary"
            isDisabled={busy}
            onClick={() => {
              if (tokens === null || !Number.isInteger(tokens) || tokens <= 0) {
                setProblem('An allowance is a positive whole number of tokens.');
                return;
              }

              void save(tokens);
            }}
          />
          {reading.override === null ? null : (
            <Button
              label="Back to the default"
              variant="secondary"
              isDisabled={busy}
              onClick={() => void save(null)}
            />
          )}
          <Button label="Cancel" variant="ghost" isDisabled={busy} onClick={onClose} />
        </div>
      </div>
    </Dialog>
  );
}
