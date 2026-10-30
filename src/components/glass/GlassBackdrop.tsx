import "./glass.css";

/** The fixed, slowly moving colour backdrop behind fluted glass. "bright" for the site, "dim" for the dashboard. */
export function GlassBackdrop({ tone = "bright" }: { tone?: "bright" | "dim" }) {
  return (
    <div className={`gb gb--${tone}`} aria-hidden="true">
      <div className="gb__field gb__field--c" />
      <div className="gb__field gb__field--d" />
      <div className="gb__field gb__field--a" />
      <div className="gb__figure" />
      <div className="gb__field gb__field--b" />
      <div className="gb__flutes" />
    </div>
  );
}
