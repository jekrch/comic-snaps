import pytest

from metadata.references import (
    SOURCE_METRON_SERIES_LOOKUP,
    _set_if_missing,
    ensure_reference,
    has_cover_source,
    has_source,
    mark_cover_source,
    mark_source,
)


class TestSetIfMissing:
    def test_sets_an_absent_field(self):
        entry = {}
        assert _set_if_missing(entry, "publisher", "Image") is True
        assert entry["publisher"] == "Image"

    def test_does_not_overwrite_an_existing_value(self):
        entry = {"publisher": "Image"}
        assert _set_if_missing(entry, "publisher", "Marvel") is False
        assert entry["publisher"] == "Image"

    @pytest.mark.parametrize("empty", [None, "", [], {}])
    def test_refuses_to_write_an_empty_value(self, empty):
        entry = {}
        assert _set_if_missing(entry, "publisher", empty) is False
        assert "publisher" not in entry

    @pytest.mark.parametrize("empty", [None, "", [], {}])
    def test_treats_an_existing_empty_as_missing(self, empty):
        entry = {"publisher": empty}
        assert _set_if_missing(entry, "publisher", "Image") is True
        assert entry["publisher"] == "Image"

    def test_zero_is_a_real_value_and_is_written(self):
        entry = {}
        assert _set_if_missing(entry, "issueCount", 0) is True
        assert entry["issueCount"] == 0

    def test_an_existing_zero_is_not_overwritten(self):
        entry = {"issueCount": 0}
        assert _set_if_missing(entry, "issueCount", 5) is False


class TestSourceMarkers:
    def test_an_unmarked_entry_has_no_source(self):
        assert has_source({}, "metron") is False

    def test_mark_then_has(self):
        entry = {}
        mark_source(entry, "metron")
        assert has_source(entry, "metron") is True
        assert entry["sources"] == ["metron"]

    def test_marking_twice_does_not_duplicate(self):
        entry = {}
        mark_source(entry, "metron")
        mark_source(entry, "metron")
        assert entry["sources"] == ["metron"]

    def test_sources_are_independent(self):
        entry = {}
        mark_source(entry, "metron")
        assert has_source(entry, "comicvine") is False

    def test_the_series_lookup_marker_is_distinct_from_the_field_backfill(self):
        # One records "Metron has no such series"; the other records "the
        # fields were backfilled". Conflating them would re-search every run.
        entry = {}
        mark_source(entry, SOURCE_METRON_SERIES_LOOKUP)
        assert has_source(entry, SOURCE_METRON_SERIES_LOOKUP) is True
        assert has_source(entry, "metron") is False


class TestCoverSources:
    def test_unmarked_entry_retries(self):
        assert has_cover_source({}, "metron", [1, 2]) is False

    def test_marked_with_the_same_issue_set_is_a_skip(self):
        entry = {}
        mark_cover_source(entry, "metron", [2, 1])
        assert has_cover_source(entry, "metron", [1, 2]) is True

    def test_a_new_gallery_issue_retriggers_the_fetch(self):
        entry = {}
        mark_cover_source(entry, "metron", [1, 2])
        assert has_cover_source(entry, "metron", [1, 2, 3]) is False

    def test_a_removed_issue_also_retriggers(self):
        entry = {}
        mark_cover_source(entry, "metron", [1, 2])
        assert has_cover_source(entry, "metron", [1]) is False

    def test_stored_sorted_and_deduped_so_the_file_does_not_re_diff(self):
        entry = {}
        mark_cover_source(entry, "metron", [3, 1, 1, 2])
        assert entry["coverSources"]["metron"] == [1, 2, 3]

    def test_sources_are_tracked_separately(self):
        entry = {}
        mark_cover_source(entry, "metron", [1])
        assert has_cover_source(entry, "comicvine", [1]) is False

    def test_marking_a_second_source_keeps_the_first(self):
        entry = {}
        mark_cover_source(entry, "metron", [1])
        mark_cover_source(entry, "comicvine", [1])
        assert has_cover_source(entry, "metron", [1]) is True
        assert has_cover_source(entry, "comicvine", [1]) is True

    @pytest.mark.parametrize("malformed", [{"coverSources": []}, {"coverSources": "x"}])
    def test_a_malformed_marker_retries_rather_than_skipping(self, malformed):
        assert has_cover_source(malformed, "metron", [1]) is False

    def test_a_malformed_per_source_value_retries(self):
        assert has_cover_source({"coverSources": {"metron": "nope"}}, "metron", [1]) is False

    def test_mark_replaces_a_malformed_container(self):
        entry = {"coverSources": "nope"}
        mark_cover_source(entry, "metron", [1])
        assert entry["coverSources"] == {"metron": [1]}

    def test_an_empty_issue_set_round_trips(self):
        entry = {}
        mark_cover_source(entry, "metron", [])
        assert has_cover_source(entry, "metron", []) is True


class TestEnsureReference:
    def test_adds_a_reference_to_a_bare_entry(self):
        entry = {}
        ensure_reference(entry, "Metron", "https://metron.cloud/series/1/")
        assert entry["references"] == [
            {"name": "Metron", "url": "https://metron.cloud/series/1/"}
        ]

    def test_does_not_add_a_second_reference_with_the_same_name(self):
        entry = {"references": [{"name": "Metron", "url": "https://metron.cloud/series/1/"}]}
        ensure_reference(entry, "Metron", "https://metron.cloud/series/999/")
        assert len(entry["references"]) == 1
        assert entry["references"][0]["url"].endswith("/1/")

    def test_name_matching_ignores_case_and_padding(self):
        entry = {"references": [{"name": "  metron  ", "url": "u"}]}
        ensure_reference(entry, "Metron", "other")
        assert len(entry["references"]) == 1

    def test_different_names_both_land(self):
        entry = {}
        ensure_reference(entry, "Metron", "a")
        ensure_reference(entry, "Comic Vine", "b")
        assert [r["name"] for r in entry["references"]] == ["Metron", "Comic Vine"]

    def test_tolerates_a_reference_with_no_name(self):
        entry = {"references": [{"url": "u"}]}
        ensure_reference(entry, "Metron", "a")
        assert len(entry["references"]) == 2
