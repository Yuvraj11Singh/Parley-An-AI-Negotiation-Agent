#!/usr/bin/env bash
# Runs the Parley Flask server using the project's virtual environment,
# so you don't need to activate it or remember the venv path.
set -e
cd "$(dirname "$0")"
./.venv/bin/python app/server.py
