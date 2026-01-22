from pydantic import BaseModel


class AudioUploadResponse(BaseModel):
    """Response after uploading audio."""

    url: str
    duration_seconds: float | None = None


class PhotoUploadResponse(BaseModel):
    """Response after uploading photo."""

    url: str


class TranscriptionResponse(BaseModel):
    """Response after transcribing audio."""

    text: str
    duration_seconds: float | None = None
    language: str | None = None


class AudioUploadWithTranscriptionResponse(BaseModel):
    """Response after uploading and transcribing audio."""

    url: str
    transcription: str
    duration_seconds: float | None = None
    language: str | None = None
