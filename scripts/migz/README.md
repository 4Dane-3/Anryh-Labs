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

```bash
NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/migz/probe-tools.mts
```

Also `probe-shapes.mts` (same command) sends the operator (advisor + fallbacks), Haiku (JSON output, web search), Opus memo and Sonnet vision request shapes.

`probe-tools.mts` sends three tiny real requests (a few tokens each, using `ANTHROPIC_API_KEY` from `.env.local`) with Migz's real tool list, to check the API accepts the tool schemas. Run it after adding or changing tools: Anthropic rejects a request when too many strict tool schemas are compiled together, and the simulated tests can't catch that.
