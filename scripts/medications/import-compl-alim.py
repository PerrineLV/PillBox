"""Build the offline Compl'Alim search snapshot from the official declarations CSV.

Usage: python3 scripts/medications/import-compl-alim.py declarations.csv \
       assets/medications/compl-alim.db

Source: https://www.data.gouv.fr/datasets/declarations-de-complements-alimentaires
Licence Ouverte / Open Licence 2.0. Only the four fields below are imported;
usage directions and daily doses are deliberately excluded.
"""

import csv
import sqlite3
import sys
from pathlib import Path


def build(source: Path, destination: Path) -> None:
    if destination.exists():
        destination.unlink()
    connection = sqlite3.connect(destination)
    try:
        connection.executescript(
            """
            CREATE TABLE supplements (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              brand TEXT,
              form TEXT
            );
            CREATE VIRTUAL TABLE supplement_search USING fts5(
              id UNINDEXED, name, brand, form,
              tokenize='unicode61 remove_diacritics 2'
            );
            """
        )
        with source.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file, delimiter=";")
            required = {"id", "nom_commercial", "marque", "forme_galenique", "decision"}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError("Le schéma du CSV Compl'Alim a changé.")
            for row in reader:
                if row["decision"] != "Commercialisation possible":
                    continue
                identifier = row["id"].strip()
                name = row["nom_commercial"].strip()
                if not identifier or not name:
                    continue
                brand = row["marque"].strip() or None
                form = row["forme_galenique"].strip() or None
                previous = connection.execute(
                    "SELECT name, brand, form FROM supplements WHERE id = ?",
                    (identifier,),
                ).fetchone()
                if previous is not None:
                    if previous != (name, brand, form):
                        raise ValueError(f"Identifiant Compl'Alim contradictoire : {identifier}")
                    continue
                connection.execute(
                    "INSERT INTO supplements VALUES (?, ?, ?, ?)",
                    (identifier, name, brand, form),
                )
                connection.execute(
                    "INSERT INTO supplement_search VALUES (?, ?, ?, ?)",
                    (identifier, name, brand, form),
                )
        connection.commit()
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("VACUUM")
    except BaseException:
        connection.close()
        destination.unlink(missing_ok=True)
        raise
    connection.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-compl-alim.py SOURCE.csv DESTINATION.db")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
