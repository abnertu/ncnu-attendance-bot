set shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]

# List available commands without running the bot.
default:
    @just --list

# Install dependencies and Chromium.
install:
    pnpm.cmd install
    pnpm.cmd exec playwright install chromium

# Save a browser session after interactive login.
login:
    pnpm.cmd run login

# Inspect selectors and save a screenshot with write protection.
inspect:
    pnpm.cmd run inspect

# Read website data without submitting attendance.
sync:
    pnpm.cmd run sync

dry-run:
    pnpm.cmd run dry-run

# Display the local daily plan and last website snapshot.
plan:
    pnpm.cmd run plan

status:
    pnpm.cmd run status

# Send one test email with the configured SMTP service.
email-test:
    pnpm.cmd run email:test

# Run one scheduling cycle; enabled configurations may submit attendance.
tick:
    pnpm.cmd run tick

lint:
    pnpm.cmd run lint

lint-fix:
    pnpm.cmd run lint:fix

format:
    pnpm.cmd run format

format-check:
    pnpm.cmd run format:check

typecheck:
    pnpm.cmd run typecheck

test:
    pnpm.cmd test

# Run all local checks and stop on the first failure.
check:
    pnpm.cmd run check

# Register or update the task for the current Windows user.
install-task:
    powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\windows\install-task.ps1

remove-task:
    powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\windows\remove-task.ps1

# Submit attendance after confirmation in an interactive terminal.
manual-checkin:
    pnpm.cmd run manual:checkin

manual-checkout:
    pnpm.cmd run manual:checkout
