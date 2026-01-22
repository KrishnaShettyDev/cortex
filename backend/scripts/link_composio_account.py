import asyncio
import sys
from uuid import UUID
from sqlalchemy import select

# Add parent to path for imports
sys.path.insert(0, '/Users/karthikreddy/Downloads/cortex/backend')

from app.database import async_session_maker
from app.models.user import User
from app.models.integration import ConnectedAccount

async def link_account(composio_id: str):
    async with async_session_maker() as db:
        # Get the first user (or specify user_id)
        result = await db.execute(select(User))
        user = result.scalar_one_or_none()

        if not user:
            print("No users found in database")
            return

        print(f"Linking to user: {user.email} ({user.id})")

        # Check if already exists
        result = await db.execute(
            select(ConnectedAccount).where(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider == "google"
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.composio_connection_id = composio_id
            print(f"Updated existing connection with ID: {composio_id}")
        else:
            account = ConnectedAccount(
                user_id=user.id,
                provider="google",
                composio_connection_id=composio_id,
                scopes=["gmail.readonly", "gmail.send", "calendar", "calendar.events"],
            )
            db.add(account)
            print(f"Created new connection with ID: {composio_id}")

        await db.commit()
        print("Done!")

if __name__ == "__main__":
    composio_id = sys.argv[1] if len(sys.argv) > 1 else "ac_HhMLr_6gPd39"
    asyncio.run(link_account(composio_id))
