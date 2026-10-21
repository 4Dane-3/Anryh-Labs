# Migz tests

Both run the real code with tsx. `server-only` is stubbed so server modules load outside Next.

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/migz/brain.test.mts
```

Pure logic (no network or database): tier routing and the monthly-budget fallback, cost math, metrics and fatigue, the diagnosis ladder, the experiment "never end early" rule, the copy-lift guardrail, advisor-before-spend ordering, the quiet-run gate, routine cadence, and real ffmpeg frame extraction.

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/migz/brain.e2e.mts
```

End to end against the real Supabase project in `.env.local`, with Meta, Higgsfield, Slack and every model tier simulated at the network / model-call boundary. It creates a throwaway agent (`e2e-brain-*`), touches nothing else, and deletes that agent (and all its rows) when it finishes, even on failure.
