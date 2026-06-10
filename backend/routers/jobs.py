from fastapi import APIRouter, Depends, HTTPException

from services.auth_dep import require_user
from services.firebase import get_db

router = APIRouter(tags=["jobs"])


@router.get("/jobs")
async def list_jobs(user_id: str = Depends(require_user)):
    db = get_db()
    query = (db.collection("jobs").where("user_id", "==", user_id)
             .order_by("created_at", direction="DESCENDING").limit(50))
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str = Depends(require_user)):
    doc = await get_db().collection("jobs").document(job_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Job not found")
    return {"id": doc.id, **doc.to_dict()}
