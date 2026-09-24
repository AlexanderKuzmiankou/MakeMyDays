from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator

from app.auth import service
from app.auth.dependencies import (
    SESSION_COOKIE_NAME,
    get_current_user,
    set_session_cookie,
)

router = APIRouter(prefix="/api/auth")


def _validate_email(value: str) -> str:
    value = value.strip().lower()
    if "@" not in value or "." not in value.split("@")[-1] or len(value) > 254:
        raise ValueError("Enter a valid email address")
    return value


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email(value)


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _validate_email(value)


class ProfileUpdate(BaseModel):
    name: str | None = None
    avatar_url: str | None = None


@router.post("/signup", status_code=201)
def signup(body: SignupRequest, response: Response) -> dict:
    #deactivated until MVP is ready
    """
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    try:
        user = service.create_user(body.email, body.password, body.name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    set_session_cookie(response, user)
    """
    user = {}
    return user


@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict:
    #deactivated until MVP is ready
    """
    try:
        user = service.authenticate_user(body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    set_session_cookie(response, user)
    """
    user = {}
    return user


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME)


@router.get("/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    return user


@router.patch("/me")
def update_me(body: ProfileUpdate, user: dict = Depends(get_current_user)) -> dict:
    try:
        return service.update_profile(user["email"], name=body.name, avatar_url=body.avatar_url)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
