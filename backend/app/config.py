from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    apple_client_id: str = "com.cortex.app"

    # Storage (Cloudflare R2)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "cortex-uploads"
    r2_endpoint: str = ""  # S3 API endpoint: https://{account_id}.r2.cloudflarestorage.com
    r2_public_url: str = ""  # Public access URL: https://pub-xxx.r2.dev or custom domain

    # AI (OpenAI)
    openai_api_key: str = ""

    # Integrations
    composio_api_key: str = ""
    google_maps_api_key: str = ""  # For Google Places search

    # Environment
    environment: str = "development"
    debug: bool = True

    # CORS - comma-separated list of allowed origins
    # In production, set to your actual domains (e.g., "https://cortex.app,https://api.cortex.app")
    cors_allowed_origins: str = ""

    # Sentry
    sentry_dsn: str = ""

    @property
    def cors_origins(self) -> list[str]:
        """Get list of allowed CORS origins based on environment."""
        if self.environment == "development":
            # Allow localhost in development
            return [
                "http://localhost:3000",
                "http://localhost:8081",
                "http://localhost:19006",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8081",
                "exp://localhost:8081",
                "exp://127.0.0.1:8081",
            ]
        elif self.cors_allowed_origins:
            # Production: use configured origins
            return [origin.strip() for origin in self.cors_allowed_origins.split(",")]
        else:
            # Production with no config: empty list (no CORS allowed)
            return []

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Module-level settings instance for easy importing
settings = get_settings()
