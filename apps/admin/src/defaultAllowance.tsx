import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { readDefaultAllowance, setDefaultAllowance } from './api/allowances';
import { formatTokens } from './allowanceText';

const styles = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: '48ch',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: spacingVars['--spacing-2'],
  },
});

/**
 * The allowance everyone gets, when they have none of their own.
 *
 * A number the console edits rather than a deployment setting: changing it moves
 * every person without an override, which is why it sits above the list it
 * governs rather than hidden behind a deploy (docs/adr/0005-allowances.md).
 */
export default function DefaultAllowance({ onChanged }: { onChanged?: (tokens: number) => void }) {
  const [tokens, setTokens] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readDefaultAllowance().then((result) => {
      if (result.ok) {
        setTokens(result.value);
        setSaved(result.value);
      } else {
        setProblem(result.message);
      }
    });
  }, []);

  async function save() {
    if (tokens === null || !Number.isInteger(tokens) || tokens <= 0) {
      setProblem('An allowance is a positive whole number of tokens.');
      return;
    }

    setBusy(true);
    setProblem(null);
    const result = await setDefaultAllowance(tokens);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }

    setSaved(result.value);
    setTokens(result.value);
    onChanged?.(result.value);
  }

  return (
    <section aria-labelledby="default-allowance-heading" {...stylex.props(styles.section)}>
      <Heading level={2} id="default-allowance-heading">
        Everyone's allowance
      </Heading>
      <Text color="secondary">
        {saved === null
          ? 'Reading the default…'
          : `Everyone without a number of their own gets ${formatTokens(saved)} tokens a month.`}
      </Text>
      <div {...stylex.props(styles.row)}>
        <NumberInput
          label="Tokens per month"
          value={tokens}
          onChange={setTokens}
          isDisabled={busy}
          status={problem === null ? undefined : { type: 'error', message: problem }}
        />
        <Button label="Save" isDisabled={busy} onClick={() => void save()} />
      </div>
    </section>
  );
}
