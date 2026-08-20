# Podcrypt upstream sync

`Upstream sync` checks `nmbrthirteen/podcli:main` every Monday at 06:17 UTC and can also be run manually from GitHub Actions.

## Safety model

The workflow never pushes to upstream and never writes directly to `main`. It:

1. fetches the exact upstream commit and simulates a merge into the current fork commit;
2. stops on any Git conflict instead of guessing which implementation to keep;
3. independently recreates the exact merged tree for every existing CI gate;
4. tests Go, TypeScript, and Python on Linux, macOS, and Windows, plus the Remotion release bundle and docs drift check;
5. publishes the tested tree to the automation-owned `automation/upstream-sync` branch and records an `Upstream sync / full verification` commit status linked to the run;
6. opens or updates one pull request for owner review.

Do not commit manual work to `automation/upstream-sync`. The workflow force-updates that branch with `--force-with-lease`. Resolve conflicts on a separate branch, merge that reviewed work into `main`, then rerun the workflow.

Fork-specific Studio, episode editor, strong-moment discovery, transcript copy, and non-destructive editing behavior require human review even when all automated checks pass. The workflow deliberately does not enable auto-merge.

When merge conflicts or checks fail, the workflow leaves `main` unchanged and creates or updates one `Upstream sync needs attention` issue linking the failed run. A later successful or no-op run closes that issue.

## Repository settings

Keep GitHub Actions' default token permission read-only. The workflow grants write access only to its final publishing/reporting jobs, after untrusted upstream code has finished running in isolated read-only jobs.

Protect `main` in GitHub settings. Require pull requests, owner approval, and the normal CI checks. Disable force pushes and branch deletion. The repository currently needs this protection configured separately because workflow files cannot safely enforce repository rules.
