#!/usr/bin/env node
import { stageCandidateRenderCli } from "../apps/render-worker/src/cli/stage-candidate.js";

stageCandidateRenderCli().then((code) => {
  if (code !== 0) {
    process.exit(code);
  }
});
