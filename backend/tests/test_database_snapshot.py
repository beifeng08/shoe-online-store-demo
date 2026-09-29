import shutil
import sqlite3
from contextlib import closing

import pytest


def test_snapshot_reads_committed_wal_without_uncommitted_writes(tmp_path, snapshot_database):
    source = tmp_path / "source.db"
    target = tmp_path / "snapshot.db"
    incomplete_copy = tmp_path / "main-file-only.db"
    with closing(sqlite3.connect(source)) as writer:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("CREATE TABLE snapshot_records (id INTEGER PRIMARY KEY)")
        writer.execute("INSERT INTO snapshot_records VALUES (1)")
        writer.commit()
        assert (tmp_path / "source.db-wal").stat().st_size > 0

        shutil.copyfile(source, incomplete_copy)
        with closing(sqlite3.connect(incomplete_copy)) as incomplete:
            with pytest.raises(sqlite3.OperationalError, match="no such table"):
                incomplete.execute("SELECT * FROM snapshot_records")

        writer.execute("BEGIN")
        writer.execute("INSERT INTO snapshot_records VALUES (2)")
        snapshot_database(source, target)
        with closing(sqlite3.connect(target)) as reader:
            assert reader.execute("SELECT * FROM snapshot_records").fetchall() == [(1,)]
            assert reader.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        writer.rollback()


def test_snapshot_keeps_migrated_template_and_other_copies_isolated(
    template, tmp_path, snapshot_database
):
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    snapshot_database(template, first)
    snapshot_database(template, second)

    with closing(sqlite3.connect(first)) as modified:
        assert modified.execute("SELECT COUNT(*) FROM products").fetchone()[0] > 0
        assert modified.execute("SELECT version_num FROM alembic_version").fetchone()
        modified.execute("CREATE TABLE isolation_probe (id INTEGER PRIMARY KEY)")
        modified.commit()

    for unchanged in (template, second):
        with closing(sqlite3.connect(unchanged)) as reader:
            assert reader.execute("SELECT COUNT(*) FROM products").fetchone()[0] > 0
            assert (
                reader.execute(
                    "SELECT name FROM sqlite_master WHERE name = 'isolation_probe'"
                ).fetchone()
                is None
            )

    first.rename(tmp_path / "renamed.db")


def test_missing_snapshot_source_fails_without_creating_an_empty_database(
    tmp_path, snapshot_database
):
    missing = tmp_path / "missing.db"
    target = tmp_path / "target.db"
    with pytest.raises((FileNotFoundError, sqlite3.OperationalError)):
        snapshot_database(missing, target)
    assert not missing.exists()
    assert not target.exists()
