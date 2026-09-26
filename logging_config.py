"""Shared application logging configuration."""
import logging
import os


def configure_logging() -> None:
    """Configure console logging, defaulting to INFO with env level override."""
    level_name = os.environ.get('CAMPUS_BUS_LOG_LEVEL', 'INFO').upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )
