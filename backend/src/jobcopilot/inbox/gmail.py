"""Gmail API, read-only scope. One-time OAuth in the browser; the refresh token lives in the OS keychain."""

import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol

import httpx
import keyring

from jobcopilot.inbox.message import EmailMessage, from_gmail

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
API = "https://gmail.googleapis.com/gmail/v1/users/me"
KEYRING_SERVICE = "jobcopilot-gmail"

# Gmail search, evaluated server-side, so unrelated mail is never downloaded.
SEARCH = (
    "(application OR applying OR applied OR candidacy OR interview OR assessment OR "
    '"coding challenge" OR offer OR unfortunately OR "next steps" OR "job alert" OR "jobs for you" OR '
    "from:jobalerts-noreply@linkedin.com OR from:jobs-noreply@linkedin.com OR from:naukri.com) "
    "-in:sent -in:drafts -in:chats"
)


class MailSource(Protocol):
    def message_ids(self, after_epoch: int) -> Iterator[str]: ...

    def get(self, message_id: str) -> EmailMessage: ...


class GmailNotAuthorized(Exception):
    pass


def authorize(client_secret_file: Path, account: str) -> None:
    """Run the browser consent flow once and store the refresh token in the OS keychain."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret_file), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True)
    stored = {
        "refresh_token": creds.refresh_token,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "token_uri": creds.token_uri,
    }
    keyring.set_password(KEYRING_SERVICE, account, json.dumps(stored))


def revoke(account: str) -> None:
    keyring.delete_password(KEYRING_SERVICE, account)


def is_authorized(account: str) -> bool:
    return keyring.get_password(KEYRING_SERVICE, account) is not None


class GmailClient:
    def __init__(self, account: str, http: httpx.Client | None = None):
        stored = keyring.get_password(KEYRING_SERVICE, account)
        if stored is None:
            raise GmailNotAuthorized(f"run `jobcopilot gmail-auth` to connect {account}")
        self._creds = json.loads(stored)
        self._http = http or httpx.Client(timeout=30)
        self._token: str | None = None
        self._expires_at = 0.0

    def _auth(self) -> dict[str, str]:
        if self._token is None or time.time() > self._expires_at - 60:
            response = self._http.post(
                self._creds["token_uri"],
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": self._creds["refresh_token"],
                    "client_id": self._creds["client_id"],
                    "client_secret": self._creds["client_secret"],
                },
            )
            if response.status_code in {400, 401}:
                raise GmailNotAuthorized("Gmail access was revoked or expired; run `jobcopilot gmail-auth` again")
            response.raise_for_status()
            body = response.json()
            self._token, self._expires_at = body["access_token"], time.time() + body.get("expires_in", 3600)
        return {"Authorization": f"Bearer {self._token}"}

    def message_ids(self, after_epoch: int) -> Iterator[str]:
        params = {"q": f"after:{after_epoch} {SEARCH}", "maxResults": 100}
        while True:
            response = self._http.get(f"{API}/messages", params=params, headers=self._auth())
            response.raise_for_status()
            body = response.json()
            for message in body.get("messages", []):
                yield message["id"]
            if "nextPageToken" not in body:
                return
            params["pageToken"] = body["nextPageToken"]

    def get(self, message_id: str) -> EmailMessage:
        response = self._http.get(f"{API}/messages/{message_id}", params={"format": "full"}, headers=self._auth())
        response.raise_for_status()
        return from_gmail(response.json())
