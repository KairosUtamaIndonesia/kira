import { Badge } from '@astryxdesign/core/Badge';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { proportional, Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import { Link } from '@tanstack/react-router';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { Readings } from './api/allowances';
import type { ListedUser } from './api/users';
import AllowanceCell from './allowanceCell';
import { useConsoleData } from './consoleData';
import EditAllowance from './editAllowance';

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    padding: spacingVars['--spacing-8'],
    '@media (max-width: 48rem)': {
      gap: spacingVars['--spacing-4'],
      padding: spacingVars['--spacing-5'],
    },
    '@media (max-width: 32rem)': {
      padding: spacingVars['--spacing-4'],
    },
  },
  pageHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: '72ch',
  },
  peopleTable: {
    minWidth: 0,
  },
});

/** The role that runs Kira, as the server's own plugin spells it. */
const ADMIN_ROLE = 'admin';

/**
 * Whether the ordinary role, or the one that runs Kira.
 *
 * A badge because this is the column the rest of the console is built on: it is
 * what decides whether someone sees more than this page.
 */
function Role({ role }: { role: string }) {
  return <Badge label={role} variant={role === ADMIN_ROLE ? 'info' : 'neutral'} />;
}

function columnsFor(
  readings: Readings,
  onEdit: (user: ListedUser) => void,
): TableColumn<ListedUser>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => (
        <Link to="/users/$id" params={{ id: user.id }}>
          {user.name}
        </Link>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => user.email,
    },
    {
      key: 'role',
      header: 'Role',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => <Role role={user.role} />,
    },
    {
      key: 'allowance',
      header: 'Allowance',
      width: proportional(1.25, { minWidth: 160 }),
      renderCell: (user) => (
        <AllowanceCell user={user} reading={readings[user.id]} onEdit={onEdit} />
      ),
    },
    {
      key: 'standing',
      header: 'Standing',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => (user.banned ? 'Suspended' : 'Active'),
    },
  ];
}

/**
 * The console: everyone who has signed in, what they may do, and what they have
 * spent of the pool.
 *
 * A row opens that person's own page, where the rest of the levers live. Changing
 * an allowance still happens here for now, and the server's answer is what the row
 * then shows.
 */
export default function People() {
  const { users, readings: read } = useConsoleData();
  const [readings, setReadings] = useState(read);
  const [editing, setEditing] = useState<ListedUser | null>(null);

  const open = editing === null ? undefined : readings[editing.id];

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.pageHeader)}>
        <Heading level={1}>People</Heading>
        <Text color="secondary">
          Everyone who has signed in to Kira. Signing in says who someone is, never what they may
          do, so this list is the whole company until a role says otherwise — and an allowance is
          what one person may spend of the shared pool in a month.
        </Text>
      </header>
      <div {...stylex.props(styles.peopleTable)}>
        <Table
          data={users}
          idKey="id"
          columns={columnsFor(readings, setEditing)}
          emptyState={
            <EmptyState
              title="Nobody has signed in yet"
              description="A person appears here once they have signed in from the desktop."
            />
          }
        />
      </div>
      {editing === null || open === undefined || !open.ok ? null : (
        <EditAllowance
          person={editing}
          reading={open.value}
          onChanged={(changed) => {
            const id = editing.id;
            setReadings((current) => ({ ...current, [id]: { ok: true, value: changed } }));
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
