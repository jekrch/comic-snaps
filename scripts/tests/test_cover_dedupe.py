import pytest

pytest.importorskip("PIL")
pytest.importorskip("imagehash")

from PIL import Image, ImageDraw  # noqa: E402

from metadata.cover_dedupe import (  # noqa: E402
    COVER_DUPLICATE_THRESHOLD,
    CoverSet,
    cover_phash,
    cover_pixels,
)


def artwork(seed: int, size: int = 256) -> Image.Image:
    """A deterministic, structured image — pHash is meaningless on noise."""
    img = Image.new("RGB", (size, size), (250, 248, 240))
    draw = ImageDraw.Draw(img)
    step = size // 8
    for i in range(8):
        for j in range(8):
            if (i * 3 + j * 5 + seed) % 4 < 2:
                draw.rectangle(
                    [i * step, j * step, (i + 1) * step, (j + 1) * step],
                    fill=(20 + seed * 40 % 200, 30, 60),
                )
    draw.ellipse([size // 4, size // 4, size * 3 // 4, size * 3 // 4], outline=(0, 0, 0), width=6)
    return img


@pytest.fixture
def root(tmp_path):
    return tmp_path


def write(root, rel: str, img: Image.Image) -> str:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=92)
    return rel


class TestCoverPhash:
    def test_hashes_a_readable_image(self, root):
        write(root, "a.jpg", artwork(1))
        assert cover_phash(root / "a.jpg") is not None

    def test_two_scans_of_one_artwork_hash_close_together(self, root):
        art = artwork(1)
        write(root, "big.jpg", art)
        write(root, "small.jpg", art.resize((128, 128)).resize((200, 200)))
        distance = cover_phash(root / "big.jpg") - cover_phash(root / "small.jpg")
        assert distance <= COVER_DUPLICATE_THRESHOLD

    def test_a_missing_file_hashes_to_none(self, root, capsys):
        assert cover_phash(root / "nope.jpg") is None
        assert "could not hash" in capsys.readouterr().err

    def test_a_non_image_hashes_to_none(self, root):
        (root / "bad.jpg").write_text("not an image")
        assert cover_phash(root / "bad.jpg") is None


class TestCoverPixels:
    def test_reports_the_pixel_area(self, root):
        write(root, "a.jpg", artwork(1, size=64))
        assert cover_pixels(root / "a.jpg") == 64 * 64

    def test_an_unreadable_file_is_zero(self, root):
        assert cover_pixels(root / "nope.jpg") == 0


class TestCoverSet:
    def test_keeps_a_single_cover(self, root):
        write(root, "a.jpg", artwork(1))
        covers = CoverSet(root, ["a.jpg"])
        assert covers.covers == ["a.jpg"]
        assert covers.deduped == 0
        assert len(covers) == 1

    def test_keeps_two_genuinely_different_covers(self, root):
        write(root, "a.jpg", artwork(1))
        write(root, "b.jpg", artwork(7))
        covers = CoverSet(root, ["a.jpg", "b.jpg"])
        assert len(covers) == 2
        assert covers.deduped == 0

    def test_drops_the_second_scan_of_one_artwork(self, root):
        # The two providers publish the same art at two URLs, so only the
        # pixels give it away.
        art = artwork(1)
        write(root, "a.jpg", art)
        write(root, "b.jpg", art.resize((128, 128)).resize((256, 256)))
        covers = CoverSet(root, ["a.jpg", "b.jpg"])
        assert len(covers) == 1
        assert covers.deduped == 1

    def test_the_higher_resolution_scan_wins(self, root):
        art = artwork(1)
        write(root, "small.jpg", art.resize((128, 128)))
        write(root, "big.jpg", art)
        covers = CoverSet(root, ["small.jpg", "big.jpg"])
        assert covers.covers == ["big.jpg"]

    def test_the_lower_resolution_scan_keeps_its_slot_position(self, root):
        art = artwork(1)
        write(root, "first.jpg", artwork(7))
        write(root, "small.jpg", art.resize((128, 128)))
        write(root, "big.jpg", art)
        covers = CoverSet(root, ["first.jpg", "small.jpg", "big.jpg"])
        assert covers.covers == ["first.jpg", "big.jpg"]

    def test_the_dropped_file_is_removed_from_disk(self, root):
        art = artwork(1)
        write(root, "big.jpg", art)
        write(root, "small.jpg", art.resize((128, 128)))
        CoverSet(root, ["big.jpg", "small.jpg"])
        # No orphan is left behind in public/data/covers.
        assert not (root / "small.jpg").exists()
        assert (root / "big.jpg").exists()

    def test_the_replaced_file_is_removed_from_disk(self, root):
        art = artwork(1)
        write(root, "small.jpg", art.resize((128, 128)))
        write(root, "big.jpg", art)
        CoverSet(root, ["small.jpg", "big.jpg"])
        assert not (root / "small.jpg").exists()

    def test_seeding_clears_an_existing_backlog_of_duplicates(self, root):
        # An entry's stored covers may already duplicate each other; that is
        # exactly what this pass exists to clear.
        art = artwork(1)
        write(root, "a.jpg", art)
        write(root, "b.jpg", art.resize((200, 200)).resize((256, 256)))
        write(root, "c.jpg", artwork(7))
        covers = CoverSet(root, ["a.jpg", "b.jpg", "c.jpg"])
        assert len(covers) == 2
        assert covers.deduped == 1

    def test_the_same_path_twice_is_not_a_dedupe(self, root):
        write(root, "a.jpg", artwork(1))
        covers = CoverSet(root, ["a.jpg"])
        assert covers.add("a.jpg") is False
        assert covers.deduped == 0
        assert (root / "a.jpg").exists()

    def test_add_reports_whether_the_set_grew(self, root):
        art = artwork(1)
        write(root, "a.jpg", art)
        write(root, "b.jpg", artwork(7))
        write(root, "dup.jpg", art)
        covers = CoverSet(root, [])
        assert covers.add("a.jpg") is True
        assert covers.add("b.jpg") is True
        assert covers.add("dup.jpg") is False

    def test_an_unhashable_cover_is_kept_rather_than_dropped(self, root, capsys):
        # Better a possible duplicate than deleting a real cover.
        (root / "bad.jpg").write_text("not an image")
        covers = CoverSet(root, ["bad.jpg"])
        assert covers.covers == ["bad.jpg"]
        assert covers.deduped == 0

    def test_two_unhashable_covers_are_both_kept(self, root):
        (root / "x.jpg").write_text("nope")
        (root / "y.jpg").write_text("nope")
        assert len(CoverSet(root, ["x.jpg", "y.jpg"])) == 2

    def test_an_empty_set(self, root):
        covers = CoverSet(root)
        assert len(covers) == 0
        assert covers.covers == []

    def test_the_threshold_stays_tight(self):
        # Measured over this collection: pairs at 10 are genuinely two
        # different variant covers, so the threshold must stay below that.
        assert COVER_DUPLICATE_THRESHOLD < 10
