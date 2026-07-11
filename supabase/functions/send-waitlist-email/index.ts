const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

Deno.serve(async (req: Request) => {
  const payload = await req.json();
  const email = payload.record?.email;

  if (!email) {
    return new Response(JSON.stringify({ error: "No email in payload" }), {
      status: 400,
    });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Pairo <onboarding@resend.dev>", // swap to hello@anryhlabs.com once that domain is verified with Resend
      to: [email],
      subject: "You're on the Pairo waitlist",
      html: "<p>Thanks for joining — we'll email you the moment Pairo is ready to play.</p>",
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
