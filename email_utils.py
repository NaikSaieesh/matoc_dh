"""
SendGrid email helper.

Sends the registration OTP (one-time passcode) to a user's email address
using the SendGrid Web API v3 (https://api.sendgrid.com/v3/mail/send).

Required environment variables (put these in your .env file):
    SENDGRID_API_KEY   - your SendGrid API key (starts with "SG.")
    SENDGRID_FROM_EMAIL - a sender email address that is verified in your
                           SendGrid account (Single Sender Verification or
                           a verified domain)
"""
import os
import requests

SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SENDGRID_FROM_EMAIL = os.environ.get("SENDGRID_FROM_EMAIL", "")

SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send"


def send_otp_email(to_email: str, otp: str, username: str = "") -> tuple[bool, str]:
    """
    Sends a one-time passcode to `to_email` via SendGrid.

    Returns (success, message).
    """
    if not SENDGRID_API_KEY or not SENDGRID_FROM_EMAIL:
        return False, "SendGrid is not configured (missing SENDGRID_API_KEY / SENDGRID_FROM_EMAIL)."

    payload = {
        "personalizations": [
            {
                "to": [{"email": to_email}],
                "subject": "Your verification code",
            }
        ],
        "from": {"email": SENDGRID_FROM_EMAIL, "name": "MATOC Dashboard"},
        "content": [
            {
                "type": "text/plain",
                "value": (
                    f"Hi {username or ''},\n\n"
                    f"Your verification code is: {otp}\n\n"
                    "This code expires in 10 minutes. If you did not request "
                    "this, you can ignore this email."
                ),
            },
            {
                "type": "text/html",
                "value": (
                    f"<p>Hi {username or ''},</p>"
                    f"<p>Your verification code is:</p>"
                    f"<h2 style='letter-spacing:4px'>{otp}</h2>"
                    "<p>This code expires in 10 minutes. If you did not "
                    "request this, you can ignore this email.</p>"
                ),
            },
        ],
    }

    headers = {
        "Authorization": f"Bearer {SENDGRID_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(SENDGRID_URL, json=payload, headers=headers, timeout=10)
        # SendGrid returns 202 Accepted on success
        if resp.status_code == 202:
            return True, "OTP sent."
        return False, f"SendGrid error ({resp.status_code}): {resp.text}"
    except requests.RequestException as e:
        return False, f"Failed to reach SendGrid: {e}"
