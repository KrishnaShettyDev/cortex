import uuid
import boto3
from botocore.config import Config
from datetime import datetime

from app.config import get_settings

settings = get_settings()


class StorageService:
    """Service for uploading files to Cloudflare R2."""

    def __init__(self):
        # R2 uses S3-compatible API
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
        )
        self.bucket = settings.r2_bucket_name
        # Use public URL if configured, otherwise fall back to endpoint
        self.public_url = settings.r2_public_url or settings.r2_endpoint

    def _generate_key(self, user_id: str, file_type: str, extension: str) -> str:
        """Generate a unique key for the file."""
        date_prefix = datetime.utcnow().strftime("%Y/%m/%d")
        unique_id = str(uuid.uuid4())
        return f"{file_type}/{user_id}/{date_prefix}/{unique_id}.{extension}"

    async def upload_audio(
        self,
        user_id: str,
        file_content: bytes,
        content_type: str = "audio/m4a",
    ) -> str:
        """
        Upload an audio file to R2.

        Args:
            user_id: The user's ID
            file_content: Audio file bytes
            content_type: MIME type of the audio

        Returns:
            Public URL of the uploaded file
        """
        # Determine extension from content type
        extension_map = {
            "audio/m4a": "m4a",
            "audio/mp4": "m4a",
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/webm": "webm",
        }
        extension = extension_map.get(content_type, "m4a")

        key = self._generate_key(user_id, "audio", extension)

        # Upload to R2
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=file_content,
            ContentType=content_type,
        )

        return f"{self.public_url}/{key}"

    async def upload_photo(
        self,
        user_id: str,
        file_content: bytes,
        content_type: str = "image/jpeg",
    ) -> str:
        """
        Upload a photo to R2.

        Args:
            user_id: The user's ID
            file_content: Image file bytes
            content_type: MIME type of the image

        Returns:
            Public URL of the uploaded file
        """
        # Determine extension from content type
        extension_map = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/heic": "heic",
        }
        extension = extension_map.get(content_type, "jpg")

        key = self._generate_key(user_id, "photos", extension)

        # Upload to R2
        self.s3_client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=file_content,
            ContentType=content_type,
        )

        return f"{self.public_url}/{key}"

    async def delete_file(self, file_url: str) -> bool:
        """
        Delete a file from R2.

        Args:
            file_url: Public URL of the file

        Returns:
            True if deleted successfully
        """
        try:
            # Extract key from URL
            key = file_url.replace(f"{self.public_url}/", "")

            self.s3_client.delete_object(
                Bucket=self.bucket,
                Key=key,
            )
            return True
        except Exception:
            return False


# Singleton instance
storage_service = StorageService()
