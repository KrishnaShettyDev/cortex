import asyncio
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, status, BackgroundTasks

from app.api.deps import CurrentUser

logger = logging.getLogger(__name__)
from app.services.storage_service import storage_service
from app.services.transcription_service import transcription_service
from app.schemas.upload import (
    AudioUploadResponse,
    PhotoUploadResponse,
    TranscriptionResponse,
    AudioUploadWithTranscriptionResponse,
)

router = APIRouter()

# Max file sizes
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_PHOTO_SIZE = 10 * 1024 * 1024  # 10 MB

# Allowed content types
ALLOWED_AUDIO_TYPES = {
    "audio/m4a",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",  # Alternative WAV MIME type
    "audio/wave",   # Another WAV variant
    "audio/webm",
    "audio/x-m4a",
    "audio/x-caf",  # iOS Core Audio Format
    "audio/aac",
    "audio/ogg",
    "audio/flac",
    "application/octet-stream",  # Fallback for unknown types
}

# File extension to MIME type mapping
EXTENSION_TO_MIME = {
    ".m4a": "audio/m4a",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".caf": "audio/x-caf",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def get_audio_content_type(file: UploadFile) -> str:
    """
    Determine the audio content type, preferring filename extension over provided content type.
    This handles cases where React Native doesn't send the correct MIME type.
    """
    # First, try to get from filename
    if file.filename:
        import os
        ext = os.path.splitext(file.filename.lower())[1]
        if ext in EXTENSION_TO_MIME:
            return EXTENSION_TO_MIME[ext]

    # Fall back to provided content type
    content_type = file.content_type or "audio/wav"
    if content_type in ALLOWED_AUDIO_TYPES:
        return content_type

    # Default to wav for unknown types
    return "audio/wav"
ALLOWED_PHOTO_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
}


@router.post("/audio", response_model=AudioUploadResponse)
async def upload_audio(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """
    Upload an audio file.

    Supported formats: M4A, MP3, WAV, WebM
    Max size: 50 MB
    """
    # Validate content type
    content_type = file.content_type or "audio/m4a"
    if content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid audio format. Allowed: {', '.join(ALLOWED_AUDIO_TYPES)}",
        )

    # Read file content
    content = await file.read()

    # Validate size
    if len(content) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {MAX_AUDIO_SIZE // (1024 * 1024)} MB",
        )

    # Upload to R2
    url = await storage_service.upload_audio(
        user_id=str(current_user.id),
        file_content=content,
        content_type=content_type,
    )

    return AudioUploadResponse(url=url)


@router.post("/photo", response_model=PhotoUploadResponse)
async def upload_photo(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """
    Upload a photo.

    Supported formats: JPEG, PNG, GIF, WebP, HEIC
    Max size: 10 MB
    """
    # Validate content type
    content_type = file.content_type or "image/jpeg"
    if content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image format. Allowed: {', '.join(ALLOWED_PHOTO_TYPES)}",
        )

    # Read file content
    content = await file.read()

    # Validate size
    if len(content) > MAX_PHOTO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {MAX_PHOTO_SIZE // (1024 * 1024)} MB",
        )

    # Upload to R2
    url = await storage_service.upload_photo(
        user_id=str(current_user.id),
        file_content=content,
        content_type=content_type,
    )

    return PhotoUploadResponse(url=url)


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """
    Transcribe an audio file using OpenAI Whisper.

    Supported formats: M4A, MP3, WAV, WebM
    Max size: 50 MB

    Returns the transcribed text without storing the audio.
    """
    # Get content type from filename or provided type
    content_type = get_audio_content_type(file)

    # Read file content
    content = await file.read()

    # Validate size
    if len(content) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {MAX_AUDIO_SIZE // (1024 * 1024)} MB",
        )

    try:
        # Transcribe
        result = await transcription_service.transcribe(
            audio_content=content,
            content_type=content_type,
        )

        return TranscriptionResponse(
            text=result["text"],
            duration_seconds=result.get("duration"),
            language=result.get("language"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription failed: {str(e)}",
        )


@router.post("/audio-with-transcription", response_model=AudioUploadWithTranscriptionResponse)
async def upload_audio_with_transcription(
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """
    Upload an audio file and transcribe it.

    This is the recommended endpoint for voice memos - it stores the audio
    and returns both the URL and the transcription.

    Supported formats: M4A, MP3, WAV, WebM
    Max size: 50 MB
    """
    # Get content type from filename or provided type
    content_type = get_audio_content_type(file)
    logger.debug(f"Upload: filename={file.filename}, provided_type={file.content_type}, resolved_type={content_type}")

    # Read file content
    content = await file.read()

    # Validate size
    if len(content) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Max size: {MAX_AUDIO_SIZE // (1024 * 1024)} MB",
        )

    try:
        # Run upload and transcription in PARALLEL for efficiency
        # This typically saves 1-2 seconds compared to sequential
        upload_task = storage_service.upload_audio(
            user_id=str(current_user.id),
            file_content=content,
            content_type=content_type,
        )
        transcribe_task = transcription_service.transcribe(
            audio_content=content,
            content_type=content_type,
        )

        # Wait for both to complete
        url, result = await asyncio.gather(upload_task, transcribe_task)

        return AudioUploadWithTranscriptionResponse(
            url=url,
            transcription=result["text"],
            duration_seconds=result.get("duration"),
            language=result.get("language"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload/transcription failed: {str(e)}",
        )
