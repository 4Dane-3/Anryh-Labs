// Makes (or finds) the "Test Hair Clinic" account staff use to see the dashboard the way a clinic does. (Clients are
// normally invited from the admin, which picks their business type; this is the scripted version for testing.)
// The login is an emailed code to TEST_CLINIC_EMAIL, so use an inbox you read. Safe to run twice.
// No Meta account and no finished setup, so the Migz crons skip it.
// Run: TEST_CLINIC_EMAIL=you+clinic@yourdomain.com NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/test-clinic-account.mts
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { supabaseAdmin: db } = await import("@/lib/supabase-admin");

const email = process.env.TEST_CLINIC_EMAIL?.trim().toLowerCase();
if (!email) throw new Error("Set TEST_CLINIC_EMAIL");
const slug = "test-hair-clinic";

const { data: existing } = await db.from("agents").select("id, slug, email").eq("slug", slug).maybeSingle();
const agent =
  existing ??
  (await db
    .from("agents")
    .insert({ slug, full_name: "Test Hair Clinic", email, active: true, service_area: "Seattle, WA", vertical: "hair_clinic", vertical_chosen_at: new Date().toISOString(), lead_goal: "inspection" })
    .select("id, slug, email")
    .single()
    .then(({ data, error }) => {
      if (error) throw error;
      return data!;
    }));

// Login: confirmed, so the sign-in page's emailed code works (it never creates users itself)
const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
let user = users.users.find((u) => u.email?.toLowerCase() === agent.email.toLowerCase());
if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email: agent.email, email_confirm: true });
  if (error) throw error;
  user = data.user!;
}
console.log(JSON.stringify({ agent: agent.slug, agentId: agent.id, login: user.email, confirmed: !!user.email_confirmed_at }));
