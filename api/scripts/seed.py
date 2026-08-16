"""Development seed:  python -m scripts.seed   (run from api/)

Creates a tenant, three groups with deliberately different reach, and four users
— so the permission filter can be *seen* working rather than taken on trust. Ask
the same question as alice and as carol and the retrieved passages differ; that
is the whole point of the ACL living inside the retrieval scan.

Idempotent: safe to re-run.
"""

from __future__ import annotations

import asyncio
import sys

from atlas import repo
from atlas.db import close_pool

TENANT_SLUG = "default"
TENANT_NAME = "Acme"

GROUPS = {
    "engineering": "Engineering",
    "hr": "People & HR",
    "public": "Company-wide",
}

# email -> (name, groups, is_admin)
USERS: dict[str, tuple[str, list[str], bool]] = {
    "alice@acme.test": ("Alice (engineering)", ["engineering", "public"], False),
    "bob@acme.test": ("Bob (engineering + HR)", ["engineering", "hr", "public"], False),
    "carol@acme.test": ("Carol (public only)", ["public"], False),
    "admin@acme.test": ("Admin", ["engineering", "hr", "public"], True),
}


async def main() -> int:
    tenant_id = await repo.ensure_tenant(TENANT_SLUG, TENANT_NAME)
    print(f"tenant  {TENANT_SLUG} ({tenant_id})")

    group_ids = {}
    for key, name in GROUPS.items():
        group_ids[key] = await repo.ensure_group(tenant_id, key, name)
        print(f"group   {key}")

    for email, (name, groups, is_admin) in USERS.items():
        user_id = await repo.ensure_user(tenant_id, email, name, is_admin)
        for key in groups:
            await repo.add_user_to_group(user_id, group_ids[key])
        flag = " [admin]" if is_admin else ""
        print(f"user    {email} -> {', '.join(groups)}{flag}")

    print(
        "\nSet ATLAS_DEV_USER=alice@acme.test in .env.local to browse as Alice, "
        "then swap the address to see the same query return a different corpus."
    )
    return 0


def run() -> None:
    code = 1
    try:
        code = asyncio.run(main())
    except Exception as exc:  # noqa: BLE001 — the message is the point
        print(f"seed failed: {exc}", file=sys.stderr)
    finally:
        asyncio.run(close_pool())
    raise SystemExit(code)


if __name__ == "__main__":
    run()
