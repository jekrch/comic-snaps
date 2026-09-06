import pytest

from metadata.sources import parse_issue_number, pick_exact_match


class TestParseIssueNumber:
    def test_reads_an_integer(self):
        assert parse_issue_number(5) == 5
        assert parse_issue_number("5") == 5

    def test_zero_is_a_real_issue_number(self):
        # One-shots and specials carry issue 0; a truthiness test would lose it.
        assert parse_issue_number(0) == 0
        assert parse_issue_number("0") == 0

    def test_none_and_empty_are_none(self):
        assert parse_issue_number(None) is None
        assert parse_issue_number("") is None

    @pytest.mark.parametrize("value", ["½", "1.MU", "Annual", "1a"])
    def test_non_whole_numbers_are_none(self, value):
        assert parse_issue_number(value) is None

    def test_a_float_is_truncated_toward_zero(self):
        assert parse_issue_number(1.9) == 1

    def test_negative_numbers_pass_through(self):
        assert parse_issue_number("-1") == -1


class TestPickExactMatch:
    def test_finds_a_case_insensitive_exact_match(self):
        results = [{"name": "Other"}, {"name": "SAGA"}]
        assert pick_exact_match(results, "saga") == {"name": "SAGA"}

    def test_ignores_a_partial_match(self):
        assert pick_exact_match([{"name": "Saga of the Swamp Thing"}], "Saga") is None

    def test_is_none_when_nothing_matches(self):
        assert pick_exact_match([{"name": "Other"}], "Saga") is None

    def test_is_none_for_an_empty_result_set(self):
        assert pick_exact_match([], "Saga") is None

    def test_ignores_padding_on_both_sides(self):
        assert pick_exact_match([{"name": "  Saga  "}], " saga ") == {"name": "  Saga  "}

    def test_tolerates_a_result_with_no_name(self):
        assert pick_exact_match([{}, {"name": "Saga"}], "Saga") == {"name": "Saga"}

    def test_returns_the_first_of_several_without_a_tiebreak(self):
        results = [{"name": "Saga", "id": 1}, {"name": "Saga", "id": 2}]
        assert pick_exact_match(results, "Saga")["id"] == 1

    def test_a_tiebreak_picks_the_highest_value(self):
        results = [
            {"name": "Saga", "id": 1, "count_of_issues": 3},
            {"name": "Saga", "id": 2, "count_of_issues": 60},
        ]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 2

    def test_a_tiebreak_treats_a_missing_key_as_zero(self):
        results = [
            {"name": "Saga", "id": 1},
            {"name": "Saga", "id": 2, "count_of_issues": 1},
        ]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 2

    def test_a_tiebreak_is_ignored_when_only_one_matches(self):
        results = [{"name": "Saga", "id": 1}, {"name": "Other", "id": 2}]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 1
