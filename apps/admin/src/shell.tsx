import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { SideNav, SideNavHeading, SideNavItem } from '@astryxdesign/core/SideNav';
import { Text } from '@astryxdesign/core/Text';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { signOut } from './api/auth';
import { useConsoleData } from './consoleData';

/** The frame every console screen is drawn in: the rail, and the screen beside it. */
export default function Shell() {
  const { who } = useConsoleData();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <AppShell
      contentPadding={0}
      variant="wash"
      sideNav={
        <SideNav
          header={<SideNavHeading heading="Kira" />}
          topContent={
            <Text color="secondary" size="sm">
              {who.email}
            </Text>
          }
          footer={
            <Button
              label="Sign out"
              variant="ghost"
              width="100%"
              onClick={() => {
                void signOut().then(() => window.location.reload());
              }}
            />
          }
        >
          <SideNavItem
            label="People"
            isSelected={pathname === '/'}
            onClick={() => void navigate({ to: '/' })}
          />
          <SideNavItem
            label="Pool"
            isSelected={pathname.startsWith('/pool')}
            onClick={() => void navigate({ to: '/pool' })}
          />
          <SideNavItem
            label="Audit"
            isSelected={pathname.startsWith('/audit')}
            onClick={() => void navigate({ to: '/audit' })}
          />
        </SideNav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
