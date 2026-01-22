import io
import tempfile
import os
from openai import AsyncOpenAI

from app.config import get_settings

settings = get_settings()


class TranscriptionService:
    """Service for transcribing audio using OpenAI Whisper."""

    MODEL = "whisper-1"

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def transcribe(
        self,
        audio_content: bytes,
        content_type: str = "audio/m4a",
        language: str = None,
    ) -> dict:
        """
        Transcribe audio content using OpenAI Whisper.

        Args:
            audio_content: Audio file bytes
            content_type: MIME type of the audio
            language: Optional language code (e.g., 'en', 'es')

        Returns:
            Dict with 'text' (transcription) and 'duration' (seconds)
        """
        # Determine file extension from content type
        extension_map = {
            "audio/m4a": "m4a",
            "audio/mp4": "m4a",
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/webm": "webm",
            "audio/x-m4a": "m4a",
            "audio/aac": "aac",
            "audio/ogg": "ogg",
            "audio/flac": "flac",
        }
        extension = extension_map.get(content_type, "m4a")

        # Create a temporary file for the audio
        # Whisper API requires a file-like object with a name
        with tempfile.NamedTemporaryFile(
            suffix=f".{extension}", delete=False
        ) as tmp_file:
            tmp_file.write(audio_content)
            tmp_file_path = tmp_file.name

        try:
            # Open the temp file and send to Whisper
            with open(tmp_file_path, "rb") as audio_file:
                kwargs = {
                    "model": self.MODEL,
                    "file": audio_file,
                    "response_format": "verbose_json",
                }
                if language:
                    kwargs["language"] = language

                response = await self.client.audio.transcriptions.create(**kwargs)

            return {
                "text": response.text.strip(),
                "duration": getattr(response, "duration", None),
                "language": getattr(response, "language", None),
            }
        finally:
            # Clean up temp file
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)

    async def transcribe_from_url(self, audio_url: str) -> dict:
        """
        Download and transcribe audio from a URL.

        Args:
            audio_url: URL of the audio file

        Returns:
            Dict with 'text' (transcription) and 'duration' (seconds)
        """
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.get(audio_url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "audio/m4a")
            audio_content = response.content

        return await self.transcribe(audio_content, content_type)


# Singleton instance
transcription_service = TranscriptionService()
