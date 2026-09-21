from alembic import context

from app.config import settings
from app.domain.models import Base
from app.infrastructure.database import make_engine

target_metadata = Base.metadata

if context.is_offline_mode():
    context.configure(
        url=settings.database_url, target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    with make_engine(settings.database_url).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
