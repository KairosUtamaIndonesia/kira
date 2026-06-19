import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { claimHandoff } from "@/features/desktop-signin/data/desktopSignin";
import { logger } from "@/lib/log";

const claimRequestSchema = z.object({
  code: z.string().min(1),
});

export const Route = createFileRoute("/api/desktop/signin/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;

        try {
          body = await request.json();
        } catch (error: unknown) {
          logger.warn("desktop.signin.claim.invalid_json", {
            error: String(error),
          });
          return Response.json({ error: "invalid_request_body" }, { status: 400 });
        }

        const parsed = claimRequestSchema.safeParse(body);

        if (!parsed.success) {
          // Zod failure is the caller's mistake — log at debug
          logger.debug("desktop.signin.claim.validation_failed", {
            issues: parsed.error.issues,
          });
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        const claimed = await claimHandoff(parsed.data.code);

        if (claimed === undefined) {
          logger.info("desktop.signin.claim.code_consumed_or_invalid", {
            codePrefix: parsed.data.code.slice(0, 8),
          });
          return Response.json({ error: "invalid_or_consumed_code" }, { status: 400 });
        }

        return Response.json({
          apiKey: claimed.apiKey,
          organizationId: claimed.organizationId,
          organizationName: claimed.organizationName,
          userName: claimed.userName,
          userEmail: claimed.userEmail,
          orgRole: claimed.orgRole,
          isPlatformAdmin: claimed.isPlatformAdmin,
        });
      },
    },
  },
});
