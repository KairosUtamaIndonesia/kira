import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "react-email";

export type InviteEmailProperties = {
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  role: string;
};

export default function InviteEmail({
  organizationName,
  inviterName,
  inviteUrl,
  role,
}: InviteEmailProperties) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {organizationName} on Kira.
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Join {organizationName} on Kira</Heading>
          <Text style={text}>
            {inviterName} invited you to join {organizationName} as {role}.
          </Text>
          <Section style={buttonSection}>
            <Button href={inviteUrl} style={button}>
              Accept invitation
            </Button>
          </Section>
          <Text style={mutedText}>
            If the button does not work, copy and paste this link into your browser:
          </Text>
          <Text style={linkText}>{inviteUrl}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f6f6f6",
  color: "#171717",
  fontFamily: "Geist Mono, sans-serif",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e5",
  borderRadius: "12px",
  margin: "40px auto",
  padding: "32px",
  width: "480px",
};

const heading = {
  fontSize: "24px",
  lineHeight: "32px",
  margin: "0 0 16px",
};

const text = {
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 16px",
};

const mutedText = {
  color: "#737373",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "24px 0 8px",
};

const linkText = {
  color: "#171717",
  fontSize: "12px",
  lineHeight: "18px",
  wordBreak: "break-all" as const,
};

const buttonSection = {
  margin: "24px 0",
};

const button = {
  backgroundColor: "#171717",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "bold",
  padding: "12px 16px",
  textDecoration: "none",
};
