from openai import AsyncOpenAI

from app.config import get_settings

settings = get_settings()


class EmbeddingService:
    """Service for generating text embeddings using OpenAI."""

    MODEL = "text-embedding-3-small"
    DIMENSIONS = 1536

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed(self, text: str) -> list[float]:
        """
        Generate embedding for a single text.

        Args:
            text: The text to embed

        Returns:
            List of 1536 floats representing the embedding
        """
        # Truncate to avoid token limits (roughly 8191 tokens max)
        # Average ~4 chars per token, so ~32000 chars max
        if len(text) > 30000:
            text = text[:30000]

        response = await self.client.embeddings.create(
            model=self.MODEL,
            input=text,
        )
        return response.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed

        Returns:
            List of embeddings (each is a list of 1536 floats)
        """
        if not texts:
            return []

        # Truncate each text
        truncated = [t[:30000] if len(t) > 30000 else t for t in texts]

        response = await self.client.embeddings.create(
            model=self.MODEL,
            input=truncated,
        )

        # Sort by index to maintain order
        embeddings = sorted(response.data, key=lambda x: x.index)
        return [e.embedding for e in embeddings]


# Singleton instance
embedding_service = EmbeddingService()
