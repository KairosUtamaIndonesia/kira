import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { claimHandoff } from "@/features/desktop-signin/data/desktopSignin";

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
        } catch {
          return Response.json({ error: "invalid_request_body" }, { status: 400 });
        }

        const parsed = claimRequestSchema.safeParse(body);

        if (!parsed.success) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        const claimed = await claimHandoff(parsed.data.code);

        if (claimed === undefined) {
          return Response.json({ error: "invalid_or_consumed_code" }, { status: 400 });
        }

        return Response.json({
          apiKey: claimed.apiKey,
          organizationId: claimed.organizationId,
          organizationName: claimed.organizationName,
          userName: claimed.userName,
          userEmail: claimed.userEmail,
        });
      },
    },
  },
});
