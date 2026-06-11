import nodemailer from "nodemailer";
import { render } from "react-email";

import InviteEmail from "@/emails/invite";
import { env } from "@/lib/env";

type SendInvitationEmailInput = {
  to: string;
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  role: string;
};

function smtpSecure(port: number) {
  if (env.SMTP_SECURE === undefined) {
    return port === 465;
  }

  return env.SMTP_SECURE === "true";
}

function createSmtpTransport() {
  const port = env.SMTP_PORT;

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: smtpSecure(port),
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
}

async function sendInvitationEmail({
  to,
  organizationName,
  inviterName,
  inviteUrl,
  role,
}: SendInvitationEmailInput) {
  const html = await render(
    <InviteEmail
      organizationName={organizationName}
      inviterName={inviterName}
      inviteUrl={inviteUrl}
      role={role}
    />,
  );
  const text = await render(
    <InviteEmail
      organizationName={organizationName}
      inviterName={inviterName}
      inviteUrl={inviteUrl}
      role={role}
    />,
    { plainText: true },
  );

  await createSmtpTransport().sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `Join ${organizationName} on Kira`,
    html,
    text,
  });
}

export { sendInvitationEmail };
