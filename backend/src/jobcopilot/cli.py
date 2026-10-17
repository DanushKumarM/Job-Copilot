"""Command line: `jobcopilot <command>`."""

import argparse
import asyncio
import logging
import sys

from jobcopilot.config import get_settings


def gmail_auth(_: argparse.Namespace) -> int:
    from jobcopilot.inbox import gmail

    settings = get_settings()
    secret = settings.gmail_client_secret_file
    if secret is None or not secret.exists():
        print("Set JOBCOPILOT_GMAIL_CLIENT_SECRET_FILE to the OAuth client JSON from Google Cloud Console.")
        return 1
    gmail.authorize(secret, settings.owner_email)
    print(f"Gmail connected read-only for {settings.owner_email}; token stored in the OS keychain.")
    return 0


def gmail_revoke(_: argparse.Namespace) -> int:
    from jobcopilot.inbox import gmail

    gmail.revoke(get_settings().owner_email)
    print("Removed the stored Gmail token. Also revoke access at https://myaccount.google.com/permissions")
    return 0


def run_now(args: argparse.Namespace) -> int:
    """Run one task immediately in this process, without the queue."""
    from jobcopilot import worker

    tasks = {
        "sync-inbox": lambda: worker.sync_inbox(timestamp=0),
        "poll-boards": lambda: worker.poll_boards(timestamp=0),
        "mark-stale": lambda: worker.mark_stale(timestamp=0),
        "rescore": worker.rescore_open_jobs,
        "refine-requirements": lambda: worker.refine_requirements(timestamp=0),
    }
    tasks[args.task]()
    return 0


def write_openapi(args: argparse.Namespace) -> int:
    """The API schema the console and extension generate their TypeScript types from."""
    import json
    from pathlib import Path

    from jobcopilot.main import app

    Path(args.path).write_text(json.dumps(app.openapi(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.path}")
    return 0


def run_evals(_: argparse.Namespace) -> int:
    """Run the hallucination evaluation benchmark harness."""
    from jobcopilot.evals.runner import main as evals_main

    return evals_main()


def run_worker(_: argparse.Namespace) -> int:
    from jobcopilot import worker

    async def run() -> None:
        async with worker.app.open_async():
            await worker.app.run_worker_async(install_signal_handlers=sys.platform != "win32")

    # Async psycopg cannot use Windows' default Proactor event loop.
    loop_factory = asyncio.SelectorEventLoop if sys.platform == "win32" else None
    try:
        asyncio.run(run(), loop_factory=loop_factory)
    except KeyboardInterrupt:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="jobcopilot")
    commands = parser.add_subparsers(required=True)
    commands.add_parser("worker", help="run the background worker").set_defaults(func=run_worker)
    commands.add_parser("gmail-auth", help="connect Gmail (read-only)").set_defaults(func=gmail_auth)
    commands.add_parser("gmail-revoke", help="forget the Gmail token").set_defaults(func=gmail_revoke)
    commands.add_parser("evals", help="run the hallucination evaluation benchmark").set_defaults(func=run_evals)
    run = commands.add_parser("run", help="run one task now, in this process")
    run.add_argument("task", choices=["sync-inbox", "poll-boards", "mark-stale", "rescore", "refine-requirements"])
    run.set_defaults(func=run_now)
    openapi = commands.add_parser("openapi", help="write the OpenAPI schema (for TypeScript types)")
    openapi.add_argument("path")
    openapi.set_defaults(func=write_openapi)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
