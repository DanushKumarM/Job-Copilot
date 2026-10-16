from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from jobcopilot.config import get_settings
from jobcopilot.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    # Procrastinate owns its tables (installed by migration 0004); autogenerate must not drop them.
    return not (type_ == "table" and name.startswith("procrastinate_"))


def database_url() -> str:
    # Tests pass an explicit URL through the Alembic config; otherwise use app settings.
    return config.attributes.get("database_url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, compare_type=True, include_object=include_object
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
