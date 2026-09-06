import sys
from pathlib import Path

# The metadata package is imported as `metadata.*`, the way the pipeline
# scripts import it, so tests exercise the real module graph.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
