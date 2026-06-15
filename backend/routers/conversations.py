"""Read/manage saved Ask AI conversations. Writes happen in the ask endpoints; this router
exposes list / open / delete so the chat UI can resume past sessions."""
import logging

from fastapi import APIRouter, Depends, HTTPException

from services.auth_dep import require_user
from services.conversations import delete_conversation, get_conversation, list_conversations
from services.firebase import get_db

router = APIRouter(tags=["conversations"])
log = logging.getLogger("clipnote.conversations")


@router.get("/conversations")
async def get_conversations(user_id: str = Depends(require_user)):
    return await list_conversations(get_db(), user_id)


@router.get("/conversations/{cid}")
async def open_conversation(cid: str, user_id: str = Depends(require_user)):
    convo = await get_conversation(get_db(), user_id, cid)
    if convo is None:
        raise HTTPException(404, "Conversation not found")
    return convo


@router.delete("/conversations/{cid}")
async def remove_conversation(cid: str, user_id: str = Depends(require_user)):
    await delete_conversation(get_db(), user_id, cid)
    return {"status": "deleted"}
