import type { Instrumentation } from "next";

// Next calls this for every error thrown while the server handles a request (rendering a page, a route
// handler, a server action). It goes to the admin Alerts and to staff in Slack.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("@/lib/admin/errors");
  await reportServerError(err, request, context);
};
