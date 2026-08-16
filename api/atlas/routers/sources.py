"""Sources: create, list, and trigger a sync."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from atlas import repo
from atlas.connectors import available_kinds
from atlas.deps import AdminPrincipal, CurrentPrincipal
from atlas.jobs import queue

router = APIRouter(prefix="/sources", tags=["sources"])

SourceKind = Literal["upload", "github", "web", "notion", "slack", "jira", "gdrive"]


class CreateSource(BaseModel):
    kind: SourceKind
    name: str = Field(min_length=1, max_length=200)
    config: dict[str, Any] = Field(default_factory=dict)
    #: Group keys that may retrieve documents from this source. Empty and not
    #: public means only an admin can reach them.
    acl_groups: list[str] = Field(default_factory=list)
    acl_public: bool = False


def _public(source: dict[str, Any]) -> dict[str, Any]:
    """`config` can hold a token. It never leaves the server."""
    config = source.get("config") or {}
    return {
        **{k: v for k, v in source.items() if k != "config"},
        "config": {k: v for k, v in config.items() if k != "token"},
        "has_token": bool(config.get("token")),
    }


@router.get("")
async def list_sources(principal: CurrentPrincipal) -> dict[str, Any]:
    sources = await repo.list_sources(principal.tenant_id)
    return {"sources": [_public(s) for s in sources], "kinds": available_kinds()}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_source(body: CreateSource, principal: AdminPrincipal) -> dict[str, Any]:
    source = await repo.create_source(
        tenant_id=principal.tenant_id,
        kind=body.kind,
        name=body.name,
        config=body.config,
        acl_groups=body.acl_groups,
        acl_public=body.acl_public,
    )
    return _public(source)


@router.post("/{source_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_source(source_id: UUID, principal: AdminPrincipal) -> dict[str, Any]:
    source = await repo.get_source(principal.tenant_id, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such source.")

    job_id = await queue.enqueue(
        kind="sync_source",
        tenant_id=principal.tenant_id,
        payload={"tenant_id": str(principal.tenant_id), "source_id": str(source_id)},
        priority=150,
        dedupe_key=f"sync:{source_id}",
    )
    await repo.set_source_status(source_id, "queued")
    # A None job id means a sync for this source is already queued or running —
    # not an error, and reporting it as one would make the button lie.
    return {"queued": True, "job_id": job_id, "already_pending": job_id is None}
