"""Set up the Homework 5 database files in hw5/data/.

The database files are not stored in this repository. This script takes the
data_2.zip provided with the assignment (or the campus_customs.db inside it)
and creates:

  data/campus_customs.db      the original database, set to read-only
  data/campus_customs_new.db  the working copy the agents read and change

Usage (run from the hw5 folder):

  python3 setup_db.py path/to/data_2.zip
  python3 setup_db.py path/to/campus_customs.db
  python3 setup_db.py --reset     # replace the working copy with a fresh copy of the original

An existing working copy is never overwritten unless --reset is given.
If a file doesn't match the database delivered in data_2.zip, the script stops
without changing anything.
"""

import argparse
import hashlib
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ORIGINAL = DATA / "campus_customs.db"
WORKING = DATA / "campus_customs_new.db"
ZIP_MEMBER = "data/campus_customs.db"

# Fingerprint of the database as delivered in data_2.zip.
EXPECTED_SHA256 = "23686a90d698f7fa6f901a3f0a9774db9cbb31e13151c9e5717275f3321f360a"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def make_read_only(path: Path) -> None:
    os.chmod(path, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)


def make_writable(path: Path) -> None:
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)


def install_original(source: Path) -> None:
    """Check the source first; only replace the original if it matches."""
    temp = DATA / "campus_customs.db.incoming"
    try:
        if zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as z:
                if ZIP_MEMBER not in z.namelist():
                    sys.exit(f"Stopped: {source} does not contain {ZIP_MEMBER}. Nothing was changed.")
                with z.open(ZIP_MEMBER) as src, open(temp, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        else:
            shutil.copyfile(source, temp)

        if sha256(temp) != EXPECTED_SHA256:
            sys.exit(f"Stopped: {source} does not match the database delivered in data_2.zip. "
                     "Nothing was changed.")

        if ORIGINAL.exists():
            make_writable(ORIGINAL)
        os.replace(temp, ORIGINAL)
        make_read_only(ORIGINAL)
    finally:
        if temp.exists():
            temp.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Set up the Homework 5 database files.")
    parser.add_argument("source", nargs="?", type=Path,
                        help="data_2.zip, or the campus_customs.db from inside it")
    parser.add_argument("--reset", action="store_true",
                        help="replace the working copy with a fresh copy of the original")
    args = parser.parse_args()

    DATA.mkdir(exist_ok=True)

    if args.source:
        if not args.source.is_file():
            sys.exit(f"File not found: {args.source}")
        if args.source.resolve() == ORIGINAL.resolve():
            make_read_only(ORIGINAL)
        else:
            install_original(args.source)
    elif not ORIGINAL.exists():
        sys.exit("No original database yet. Run: python3 setup_db.py path/to/data_2.zip")

    if sha256(ORIGINAL) != EXPECTED_SHA256:
        sys.exit("Stopped: data/campus_customs.db does not match the database delivered in "
                 "data_2.zip. Nothing was changed. Run the script again with data_2.zip to restore it.")
    print(f"Original:     {ORIGINAL.relative_to(HERE)} (read-only)")

    if WORKING.exists() and not args.reset:
        print(f"Working copy: {WORKING.relative_to(HERE)} already exists, left unchanged "
              "(use --reset to start over from the original)")
        return
    if WORKING.exists():
        make_writable(WORKING)
    shutil.copyfile(ORIGINAL, WORKING)
    make_writable(WORKING)
    print(f"Working copy: {WORKING.relative_to(HERE)} (fresh copy of the original)")


if __name__ == "__main__":
    main()
