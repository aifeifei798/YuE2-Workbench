"""Login/logout/me. Passwords come from settings (admin_password / share_password)."""

import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from ..core.config import settings
from ..services import auth_svc

router = APIRouter(prefix="/api", tags=["auth"])

_login_tries: dict[str, tuple[int, float]] = {}
_WINDOW = 60.0
_MAX_TRIES = 8


def _rate_ok(ip: str) -> bool:
    now = time.time()
    n, t0 = _login_tries.get(ip, (0, now))
    if now - t0 > _WINDOW:
        n, t0 = 0, now
    n += 1
    _login_tries[ip] = (n, t0)
    return n <= _MAX_TRIES


class LoginIn(BaseModel):
    password: str


def _auth_enabled() -> bool:
    return bool(settings.admin_password)


@router.get("/me")
def me(request: Request):
    if not _auth_enabled():
        return {"enabled": False, "role": "admin"}
    secret = auth_svc.secret_for(settings.admin_password, settings.auth_secret)
    role = auth_svc.parse_token(request.cookies.get(auth_svc.COOKIE), secret)
    return {"enabled": True, "role": role}


@router.post("/login")
def login(req: LoginIn, request: Request, response: Response):
    if not _auth_enabled():
        raise HTTPException(400, "鉴权未启用(本机模式)")
    if not _rate_ok(request.client.host if request.client else "?"):
        raise HTTPException(429, "尝试太频繁,稍后再试")
    secret = auth_svc.secret_for(settings.admin_password, settings.auth_secret)
    if req.password == settings.admin_password:
        role = "admin"
    elif settings.share_password and req.password == settings.share_password:
        role = "listen"
    else:
        raise HTTPException(401, "密码不对")
    token = auth_svc.make_token(role, secret)
    response.set_cookie(
        auth_svc.COOKIE, token, max_age=auth_svc.TTL, httponly=True, samesite="lax", path="/"
    )
    return {"role": role}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth_svc.COOKIE, path="/")
    return {"ok": True}
