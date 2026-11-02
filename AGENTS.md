# AGENTS Instructions

## Git

- Write commits in [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) format.
- Start the type, scope, and description in lowercase. Preserve code identifiers and proper nouns.
- Explain the reason for a non-trivial change in the commit body.
- Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.
- Author commits as the user alone. Add no agent trailers or session links.
- Commit as the plan progresses.
- Squash related commits before pushing to keep history clear.
- Push only after the user approves the push.
- Keep personal configuration, browser sessions, attendance records, and screenshots outside version control.

## Releases

Apply these rules when introducing a release workflow:

- Use [Semantic Versioning 2.0.0](https://semver.org/).
- Use bare version tags, such as `1.2.3`. Preserve an established prefix if the repository later adopts one.
- Use [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) for a new changelog. Preserve an existing changelog format.
- Complete releases in this order:
  1. Update version files and the changelog in one commit, such as `chore(release): prepare 1.2.3`.
  2. Push that commit to `main` after approval.
  3. Wait for that commit's branch checks to pass.
  4. Create an annotated tag: `git tag -a 1.2.3 -m "Release 1.2.3" <commit>`.
  5. Push the tag alone after approval: `git push origin 1.2.3`.
- Use `1.2.3-rc.1` for a release candidate.
- Let the tag workflow build, smoke-test, publish approved artifacts, and create the release.
- Preserve the package's private status unless the user requests publication.
- Push the commit and tag separately. Avoid `git push --follow-tags`, which can start overlapping workflows.

## Tests

- Add a persistent test only for behavior that existing tests do not cover.
- Ensure each test fails when its guarded behavior breaks.
- Use throwaway checks freely. Keep them outside the repository unless they meet the persistent-test requirement.
- Run `just check`, or `pnpm run check`, after source, tooling, or scheduler changes.
- Use isolated local fixtures for verification. Production website access requires an explicit user request.
- Keep browser fixtures restricted to their local server. Never load the real browser session in tests.
- Intercept scheduler registration in tests. Construct real task definitions without installing, starting, or removing live tasks.
- Validate PowerShell syntax and UTF-8 BOM after editing `.ps1` files.

## CI

- Keep each check only when it detects a concrete failure that another check does not cover.
- Identify that failure before adding a check. Apply the test rules to CI checks.
- Exercise entry points with real inputs or isolated fixtures.
- Reject duplicate checks, source-text assertions, copied inventories, and checks that only establish file or command existence.
- Name workflows, jobs, and steps by their target and action.
- Propagate command failures. Treat missing prerequisites and skipped required coverage as failures.
- Run checks in branch workflows. Use tag workflows to build, smoke-test, publish approved artifacts, and create releases.
- Start release jobs by verifying that the tagged commit belongs to `main`.
- Match release tags to the version format: `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`.
- Protect release tags. Restrict release credentials to protected release references.
- Merge CI changes before tagging. A tag workflow uses the configuration from the tagged commit.
- Audit the repository after changing these rules.
- Validate locally, then verify required CI on the pushed commit when pushing is authorized.
- Report uncovered contracts and unavailable checks.

For GitHub workflows:

- Run checks on `pull_request` and branch `push` events.
- Use a separate release workflow for tag pushes.
- Use tag globs such as `[0-9]+.[0-9]+.[0-9]+` and `[0-9]+.[0-9]+.[0-9]+-*`.
- Check out release jobs with `fetch-depth: 0` so the ancestry check sees `main`.
- Keep release secrets in an environment restricted to release tags. Protect those tags with a ruleset.
- Run scheduler checks on Windows so PowerShell and ScheduledTasks coverage execute.

## Attendance boundaries

- Let the website determine workdays and existing attendance. Unknown or conflicting website data must stop submission.
- Preserve make-up workdays. Apply weekday filtering only when the website calendar is explicitly disabled.
- Keep attendance submission inside `punchOnPage`. Navigation and synchronization must remain read-only.
- Keep read-only commands protected at both the DOM event and request boundaries, even when execution is enabled.
- Re-read attendance records, the date, and the allowed execution window immediately before sending.
- Persist `started` before clicking. Never automatically resubmit `started` or `needs-review` jobs.
- Retry preflight failures only when submission has not started and the allowed execution window remains open.
- Preserve interactive confirmation for manual commands, which bypass the enabled switch and scheduling window.
- Retain both process locking and scheduler overlap prevention. Manual invocations also need the process lock.
- Keep website snapshots informational. Never use cached snapshots to authorize submission.
- Leave login, execution enablement, live task installation, and ambiguous-result review to the user unless explicitly requested.

## Windows and tooling

- Let Task Scheduler start each minute. Let the TypeScript runner own randomized seconds and lateness decisions.
- Keep task registration under the installing user's identity so local sessions and browser assets remain available.
- Preserve passwordless S4U registration, limited privileges, and hidden task settings.
- Keep `justfile` compatible with Windows PowerShell 5.1. Avoid dependencies on Unix shells.
- Let just delegate application and validation commands to package scripts.
- Let ESLint enforce code rules and statement spacing. Let Prettier own indentation, wrapping, quotes, and line endings.
- Run ESLint fixes before Prettier when applying both tools.
- Preserve UTF-8 with BOM and CRLF in PowerShell scripts. Follow `.editorconfig` for other files.
- Keep personal JSON overrides local. Change shared defaults only when the behavior should apply to every user.

## Docs

- Keep documents concise and plain. Give each sentence one purpose.
- Keep only standing rules in this file. Record individual failures in comments, tests, commit bodies, decisions, or issues.
- Use US English for English documents and follow [ASD-STE100](https://www.asd-ste100.org/) writing rules.
- Give one instruction per sentence. Use the imperative and active voice.
- Use one term per concept and one meaning per term.
- Limit instructions to 20 words and descriptions to 25 words. Split longer sentences that combine facts or instructions.
- Use numbered lists for three or more instructions in a fixed order.
- Use bullets for full-sentence items or sets larger than five items.
- Draft non-English documents in English first, then translate them.
- Preserve sentence boundaries, commands, paths, and code during translation. Use natural target-language word order.
- Keep the README in Traditional Chinese and agent instructions in English.
- Verify setup commands and scheduler requirements when changing installation or execution behavior.
