"""Cookie session auth: two roles (admin/listen), HMAC-signed, stdlib only.

Cookies (not bearer headers) because EventSource and <a download> can't set
custom headers. SameSite=Lax mitigates cross-site POST (CSRF).
"""

import hashlib
import hmac
import time

COOKIE = "wb_session"
TTL = 30 * 86400


def secret_for(admin_password: str, auth_secret: str) -> bytes:
    return (auth_secret or f"wb:{admin_password}").encode()


def make_token(role: str, secret: bytes) -> str:
    exp = str(int(time.time()) + TTL)
    payload = f"{role}|{exp}"
    sig = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}|{sig}"


def parse_token(token: str | None, secret: bytes) -> str | None:
    if not token:
        return None
    try:
        role, exp, sig = token.split("|")
    except ValueError:
        return None
    if not exp.isdigit() or int(exp) < time.time():
        return None
    good = hmac.new(secret, f"{role}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return role if hmac.compare_digest(sig, good) else None
