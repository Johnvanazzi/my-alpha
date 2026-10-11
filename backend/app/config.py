from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://alpha:alpha@localhost:5432/alpha"
    cors_origins: list[str] = ["http://localhost:3000"]
    # Seconds that Yahoo Finance responses are kept in memory.
    market_cache_ttl: int = 900
    fundamentals_cache_ttl: int = 6 * 3600


settings = Settings()
