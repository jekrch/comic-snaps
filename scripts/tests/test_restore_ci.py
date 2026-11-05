"""The checks restore.yml runs on a restoration before committing it."""
import restore_ci


def panel(**fields):
    base = {"seq": 7, "id": "saga-4-1", "title": "Saga", "issue": 4, "artist": "Fiona Staples",
            "image": "images/saga/issue-4-1.jpg", "width": 800, "height": 1280, "phash": "aa"}
    return {**base, **fields}


def other():
    return {"seq": 8, "id": "hup-1-2", "title": "Hup", "issue": 1, "image": "images/hup/issue-1-2.jpg"}


def test_a_clean_install_passes():
    before = [panel(), other()]
    after = [panel(image="images/saga/issue-4-1-v2.jpg", phash="bb"), other()]
    assert restore_ci.gallery_problems(before, after, "saga-4-1") == []


def test_no_change_passes():
    assert restore_ci.gallery_problems([panel(), other()], [panel(), other()], "saga-4-1") == []


def test_another_panel_changing_is_refused():
    after = [panel(image="images/saga/issue-4-1-v2.jpg"), {**other(), "image": "images/hup/x.jpg"}]
    assert restore_ci.gallery_problems([panel(), other()], after, "saga-4-1") == ["hup-1-2 changed too"]


def test_caption_fields_on_the_panel_are_refused():
    # /approve copies only the image metadata, so a retitle here would vanish.
    after = [panel(image="images/saga/issue-4-1-v2.jpg", title="Saga!"), other()]
    problems = restore_ci.gallery_problems([panel(), other()], after, "saga-4-1")
    assert problems == ["saga-4-1: fields outside the image metadata changed: title"]


def test_removed_or_reordered_panels_are_refused():
    assert restore_ci.gallery_problems([panel(), other()], [panel()], "saga-4-1")
    assert restore_ci.gallery_problems([panel(), other()], [other(), panel()], "saga-4-1")


def test_label():
    assert restore_ci.label(panel()) == "Saga #4 (Fiona Staples)"
    assert restore_ci.label(panel(issue="Annual 2", artist=None)) == "Saga Annual 2"


def test_load_panels_reads_crlf():
    assert restore_ci.load_panels('{\r\n  "panels": []\r\n}') == []


def test_a_new_image_goes_beside_the_old_one():
    before = "images/saga/issue-4-1.jpg"
    assert restore_ci.image_path_problem(before, "images/saga/issue-4-1-v2.jpg") is None
    for after in ("data/artists.json", "index.html", "images/saga/../../data/series.json",
                  "images/hup/issue-1-2.jpg", "images/saga/issue-4-1-v2.png"):
        assert restore_ci.image_path_problem(before, after), after


def test_lookup_values_stay_on_one_line():
    # A newline in a title would start a second GITHUB_OUTPUT entry.
    assert restore_ci.one_line("Saga\nimage=../x") == "Saga image=../x"
    assert restore_ci.label(panel(title="Saga\r\n")) == "Saga\r\n #4 (Fiona Staples)"
    assert restore_ci.one_line(restore_ci.label(panel(title="Saga\r\n"))) == "Saga #4 (Fiona Staples)"


def test_a_clear_check_starts_at_that_skill():
    bw = restore_ci.start_directions("bw", "/w/source.jpg")
    assert "activate the restore-bw-panel skill" in bw and "use restore-color-panel instead" in bw
    color = restore_ci.start_directions("color", "/w/source.jpg")
    assert "activate the restore-color-panel skill" in color and "use restore-bw-panel instead" in color
    for text in (bw, color):
        assert "/w/source.jpg as PHOTO.jpg" in text and "enhance step" in text


def test_an_unsure_check_leaves_the_choice_to_the_model():
    text = restore_ci.start_directions("unsure", "/w/source.jpg")
    assert "restore-color-panel" in text and "restore-bw-panel" in text
    assert "activate the" not in text  # No skill is named as the answer.
    assert "/w/source.jpg as PHOTO.jpg" in text
