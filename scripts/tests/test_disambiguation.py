import json

import pytest

from metadata import disambiguation
from metadata.disambiguation import (
    get_disambiguation_id,
    load_disambiguation,
    record_disambiguation_candidates,
    save_disambiguation,
)


class TestGetDisambiguationId:
    def test_reads_a_resolved_id(self):
        data = {"metron:series": {"Deadline": {"id": 42}}}
        assert get_disambiguation_id(data, "metron", "series", "Deadline") == 42

    def test_is_none_while_the_entry_is_unresolved(self):
        data = {"metron:series": {"Deadline": {"id": None, "candidates": []}}}
        assert get_disambiguation_id(data, "metron", "series", "Deadline") is None

    def test_is_none_for_an_unknown_name(self):
        assert get_disambiguation_id({"metron:series": {}}, "metron", "series", "X") is None

    def test_is_none_for_an_unknown_key(self):
        assert get_disambiguation_id({}, "metron", "series", "X") is None

    def test_source_and_resource_form_the_key(self):
        data = {"metron:creator": {"Moebius": {"id": 7}}}
        assert get_disambiguation_id(data, "metron", "creator", "Moebius") == 7
        assert get_disambiguation_id(data, "metron", "series", "Moebius") is None
        assert get_disambiguation_id(data, "comicvine", "creator", "Moebius") is None

    def test_a_non_dict_entry_is_ignored(self):
        assert get_disambiguation_id({"metron:series": {"X": 42}}, "metron", "series", "X") is None

    def test_a_falsy_id_is_treated_as_unresolved(self):
        assert get_disambiguation_id({"metron:series": {"X": {"id": 0}}}, "metron", "series", "X") is None


class TestRecordDisambiguationCandidates:
    def test_records_id_and_name_for_each_candidate(self):
        data = {}
        record_disambiguation_candidates(
            data, "metron", "series", "Deadline",
            [{"id": 1, "name": "Deadline (1988)"}, {"id": 2, "name": "Deadline (2002)"}],
        )
        assert data["metron:series"]["Deadline"] == {
            "id": None,
            "candidates": [
                {"id": 1, "name": "Deadline (1988)"},
                {"id": 2, "name": "Deadline (2002)"},
            ],
        }

    def test_caps_the_list_at_ten(self):
        data = {}
        candidates = [{"id": i, "name": str(i)} for i in range(30)]
        record_disambiguation_candidates(data, "metron", "series", "X", candidates)
        assert len(data["metron:series"]["X"]["candidates"]) == 10

    def test_never_clobbers_a_pending_resolution(self):
        data = {"metron:series": {"Deadline": {"id": 42}}}
        record_disambiguation_candidates(data, "metron", "series", "Deadline", [{"id": 9}])
        assert data["metron:series"]["Deadline"] == {"id": 42}

    def test_tolerates_candidates_missing_fields(self):
        data = {}
        record_disambiguation_candidates(data, "metron", "series", "X", [{}])
        assert data["metron:series"]["X"]["candidates"] == [{"id": None, "name": None}]

    def test_records_an_empty_candidate_list(self):
        data = {}
        record_disambiguation_candidates(data, "metron", "series", "X", [])
        assert data["metron:series"]["X"] == {"id": None, "candidates": []}

    def test_adds_to_an_existing_section(self):
        data = {"metron:series": {"Other": {"id": 1}}}
        record_disambiguation_candidates(data, "metron", "series", "New", [{"id": 2, "name": "N"}])
        assert set(data["metron:series"]) == {"Other", "New"}


class TestLoadAndSave:
    @pytest.fixture(autouse=True)
    def _tmp_path(self, tmp_path, monkeypatch):
        self.path = tmp_path / "disambiguation.json"
        monkeypatch.setattr(disambiguation, "DISAMBIGUATION_PATH", self.path)

    def test_missing_file_loads_as_empty(self):
        assert load_disambiguation() == {}

    def test_round_trips(self):
        save_disambiguation({"metron:series": {"X": {"id": 1}}})
        assert load_disambiguation() == {"metron:series": {"X": {"id": 1}}}

    def test_written_indented_and_newline_terminated(self):
        # The file is committed, so it has to diff cleanly.
        save_disambiguation({"a": {"b": {"id": 1}}})
        raw = self.path.read_text()
        assert raw.endswith("\n")
        assert "\n  " in raw
        assert json.loads(raw) == {"a": {"b": {"id": 1}}}
