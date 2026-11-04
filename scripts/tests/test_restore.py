"""The restore skills' pure helpers. Image processing itself is judged by eye."""
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "skills"
sys.path.insert(0, str(SKILLS / "restore-panel"))

import panel  # noqa: E402


def make_panel(**fields):
    base = {"id": "bleeding-hearts-8-1791159081", "title": "Bleeding Hearts", "slug": "bleeding-hearts",
            "issue": 8, "artist": "Stipan Morian"}
    return {**base, **fields}


@pytest.mark.parametrize(
    "query, hit",
    [
        (["bleeding", "hearts"], True),
        (["Bleeding", "Hearts", "8", "morian"], True),
        (["#8"], True),
        (["18"], False),  # Numbers match the issue exactly, not as a substring.
        (["bleeding", "9"], False),
        (["1791159081"], True),  # The timestamp is part of the id.
        (["ghost"], False),
    ],
)
def test_matches(query, hit):
    assert panel.matches(make_panel(), query) is hit


def test_matches_text_issues():
    omaha = make_panel(title="Omaha", slug="omaha", artist="Reed Waller", issue="Vol 8", id="omaha-vol-8-1782027293")
    assert panel.matches(omaha, ["omaha", "vol", "8"])
    assert not panel.matches(omaha, ["omaha", "9"])
    assert panel.matches(make_panel(issue="N/A", id="trina-s-women-n-a-1793573911"), ["bleeding"])


@pytest.mark.parametrize(
    "image, version, original",
    [
        ("images/x/issue-6-123.jpg", None, "images/x/issue-6-123.jpg"),
        ("images/x/issue-6-123-v2.jpg", 2, "images/x/issue-6-123.jpg"),
        ("images/x/issue-vol-8-123-v11.jpg", 11, "images/x/issue-vol-8-123.jpg"),
    ],
)
def test_versions(image, version, original):
    assert panel.restored_version(image) == version
    assert panel.original_image(image) == original


def test_next_version_continues_the_count():
    pytest.importorskip("cv2")
    sys.path.insert(0, str(SKILLS / "restore-bw-panel"))
    import restore

    assert restore.next_image_path("images/x/issue-6-123.jpg") == "images/x/issue-6-123-v2.jpg"
    assert restore.next_image_path("images/x/issue-6-123-v2.jpg") == "images/x/issue-6-123-v3.jpg"


@pytest.fixture
def color():
    pytest.importorskip("cv2")
    sys.path.insert(0, str(SKILLS / "restore-color-panel"))
    import restore_color

    return restore_color


def lab_image(L, a, b, shape=(40, 40)):
    import numpy as np

    out = np.zeros(shape + (3,), np.float32)
    out[..., 0], out[..., 1], out[..., 2] = L, a, b
    return out


def test_keep_dark_hue_restores_hue_but_not_lightness_or_chroma(color):
    import numpy as np

    src = lab_image(20, 10, 15)  # Dark brown, hue ~56.
    out = lab_image(15, 18, 8)  # Pulled toward red, hue ~24.
    kept, weight = color.keep_dark_hue(out, src)
    assert weight.min() > 0.99
    hue = np.degrees(np.arctan2(kept[..., 2], kept[..., 1]))
    assert np.allclose(hue, np.degrees(np.arctan2(15, 10)), atol=0.5)
    assert np.allclose(kept[..., 0], 15)
    assert np.allclose(np.hypot(kept[..., 1], kept[..., 2]), np.hypot(18, 8), atol=1e-3)


def test_keep_dark_hue_leaves_light_and_neutral_areas(color):
    import numpy as np

    out = lab_image(60, 18, 8)
    kept, _ = color.keep_dark_hue(out, lab_image(60, 10, 15))  # Too light to touch.
    assert np.allclose(kept, out)
    kept, _ = color.keep_dark_hue(lab_image(15, 18, 8), lab_image(15, 0.5, 0.5))  # No hue to keep.
    assert np.allclose(kept, lab_image(15, 18, 8))


def test_white_gate_excludes_painted_flats(color):
    import numpy as np

    lab = lab_image(80, 22, 33, shape=(60, 120))
    lab[:, 60:, 1:] = (26, 68)  # A yellow flat as bright as the paper.
    ungated = color.white_candidates(lab)
    gated = color.white_candidates(lab, gate=(80, 22, 33))
    assert ungated[:, 70:].any()
    assert not gated[:, 70:].any()
    assert gated[:, 5:50].all()
