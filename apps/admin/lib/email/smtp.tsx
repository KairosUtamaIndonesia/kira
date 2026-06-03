import nodemailer from "nodemailer";
import { render } from "react-email";

import InviteEmail from "@/emails/invite";
import { requireEnvironmentVariable } from "@/lib/env";

type SendInvitationEmailInput = {
  to: string;
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  role: string;
};

function smtpPort() {
  const rawPort = requireEnvironmentVariable("SMTP_PORT");
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function smtpSecure(port: number) {
  const rawSecure = process.env.SMTP_SECURE;

  if (rawSecure === undefined || rawSecure.length === 0) {
    return port === 465;
  }

  if (rawSecure === "true") {
    return true;
  }

  if (rawSecure === "false") {
    return false;
  }

  throw new Error("SMTP_SECURE must be true or false when provided.");
}

function createSmtpTransport() {
  const port = smtpPort();

  return nodemailer.createTransport({
    host: requireEnvironmentVariable("SMTP_HOST"),
    port,
    secure: smtpSecure(port),
    auth: {
      user: requireEnvironmentVariable("SMTP_USER"),
      pass: requireEnvironmentVariable("SMTP_PASSWORD"),
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
    from: requireEnvironmentVariable("SMTP_FROM"),
    to,
    subject: `Join ${organizationName} on Kira`,
    html,
    text,
  });
}

export { sendInvitationEmail };
