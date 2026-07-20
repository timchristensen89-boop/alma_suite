#!/usr/bin/env python3
"""Poll reservations@almagroup.com.au for SevenRooms export emails and feed
them to the suite's inbound webhook.

Runs from cron on the VPS. Reads UNSEEN messages via IMAP (BODY.PEEK so
nothing is marked read until the webhook accepts it), converts each message to
the JSON shape the /webhooks/sevenrooms/email endpoint expects (Resend-style:
data.message_id / subject / from / text / attachments[{filename, content_type,
content: base64}]), POSTs it, and only then marks the message \\Seen.

The webhook itself dedupes on Message-ID, so re-processing a message is always
a safe no-op. Config comes from environment variables:
  SR_IMAP_HOST  (default mail.almagroup.com.au)
  SR_IMAP_USER  e.g. reservations@almagroup.com.au
  SR_IMAP_PASS
  SR_WEBHOOK_URL  full URL including ?token=…
Exits quietly (0) when unconfigured so the cron line is safe to install early.
"""

import base64
import email
import email.policy
import imaplib
import json
import os
import sys
import urllib.request

HOST = os.environ.get("SR_IMAP_HOST", "mail.almagroup.com.au")
USER = os.environ.get("SR_IMAP_USER", "")
PASSWORD = os.environ.get("SR_IMAP_PASS", "")
WEBHOOK_URL = os.environ.get("SR_WEBHOOK_URL", "")


def log(message: str) -> None:
    print(message, flush=True)


def message_to_payload(msg: email.message.EmailMessage) -> dict:
    attachments = []
    text_body = None
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        if filename:
            payload = part.get_payload(decode=True) or b""
            attachments.append(
                {
                    "filename": filename,
                    "content_type": part.get_content_type(),
                    "content": base64.b64encode(payload).decode("ascii"),
                }
            )
        elif part.get_content_type() == "text/plain" and text_body is None:
            payload = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            text_body = payload.decode(charset, errors="replace")

    return {
        "type": "email.received",
        "data": {
            "message_id": msg.get("Message-Id", "").strip(),
            "from": msg.get("From", ""),
            "subject": msg.get("Subject", ""),
            "text": text_body,
            "attachments": attachments,
        },
    }


def post_payload(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        WEBHOOK_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    if not USER or not PASSWORD or not WEBHOOK_URL:
        return 0  # not configured yet — silently succeed so cron stays quiet

    mailbox = imaplib.IMAP4_SSL(HOST)
    try:
        mailbox.login(USER, PASSWORD)
        mailbox.select("INBOX")
        status, data = mailbox.search(None, "UNSEEN")
        if status != "OK":
            log(f"search failed: {status}")
            return 1
        ids = data[0].split()
        if not ids:
            return 0
        log(f"{len(ids)} unseen message(s)")
        for msg_id in ids:
            status, fetched = mailbox.fetch(msg_id, "(BODY.PEEK[])")
            if status != "OK" or not fetched or fetched[0] is None:
                log(f"fetch failed for {msg_id!r}")
                continue
            raw = fetched[0][1]
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            payload = message_to_payload(msg)
            try:
                result = post_payload(payload)
            except Exception as error:  # leave unseen; retried next run
                log(f"webhook POST failed for {payload['data']['message_id']}: {error}")
                continue
            log(
                f"processed {payload['data']['message_id']} "
                f"subject={payload['data']['subject']!r} result={json.dumps(result)}"
            )
            mailbox.store(msg_id, "+FLAGS", "\\Seen")
        return 0
    finally:
        try:
            mailbox.logout()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
